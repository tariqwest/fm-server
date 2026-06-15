// ============================================================================
// LanguageModel.ts — Pythonic SDK interface for Apple Foundation Models
//
// Mirrors the ergonomics of python-apple-fm-sdk:
// - SystemLanguageModel: Check availability, get default model
// - LanguageModelSession: Stateful conversation with respond() and streamResponse()
//
// Usage:
//   import * as fm from '@afm-js/core';
//   const model = new fm.SystemLanguageModel();
//   const [available, reason] = await model.isAvailable();
//   const session = new fm.LanguageModelSession({ instructions: "..." });
//   const response = await session.respond("Hello!");
// ============================================================================

import { UnifiedBackend, HelperProcessManager } from "../bridge/index.js";
import { FmProcessManager } from "../fm/FmProcessManager.js";
import { AfmError } from "../errors/AfmError.js";

export type ModelBackendType = "onDevice" | "privateCloudCompute";

export interface LanguageModelSessionOptions {
  /** System instructions for the session */
  instructions?: string;
  /** Which backend to use (default: "onDevice") */
  backend?: ModelBackendType;
  /** Temperature (0-1). Higher = more random */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Seed for deterministic generation */
  seed?: number;
  /** Custom socket path for FM CLI */
  socketPath?: string;
  /** Path to afm-fm-helper binary */
  helperPath?: string;
  /** Enable debug logging */
  debug?: boolean | ((msg: string) => void);
}

export interface ModelResponse {
  /** The generated text content */
  content: string;
  /** Reason generation stopped */
  finishReason: string;
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ResponseChunk {
  /** Incremental text delta */
  text: string;
  /** True if this is the final chunk */
  isFinal: boolean;
  /** Reason generation stopped (only present when isFinal is true) */
  finishReason?: string;
  /** Token usage statistics (only present when isFinal is true) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export type AvailabilityReason =
  | "available"
  | "appleIntelligenceNotEnabled"
  | "deviceNotEligible"
  | "modelNotReady"
  | "unknownUnavailable";

/**
 * Represents the system foundation model.
 * Mirrors python-apple-fm-sdk's SystemLanguageModel class.
 */
export class SystemLanguageModel {
  private backend?: UnifiedBackend;
  private debug: (msg: string) => void;
  private options: {
    socketPath?: string;
    helperPath?: string;
    debug?: boolean | ((msg: string) => void);
  };

  constructor(options: {
    socketPath?: string;
    helperPath?: string;
    debug?: boolean | ((msg: string) => void);
  } = {}) {
    this.options = options;
    this.debug =
      typeof options.debug === "function"
        ? options.debug
        : options.debug
          ? (msg: string) => console.debug(`[SystemLanguageModel] ${msg}`)
          : () => {};
  }

  /**
   * Check if the model is available on this device.
   * Returns a tuple [isAvailable, reason] matching Python SDK semantics.
   */
  async isAvailable(): Promise<[boolean, AvailabilityReason]> {
    await this.ensureBackend();

    try {
      const reply = await this.backend!.request({ op: "availability" });

      if ("ok" in reply && reply.ok === true && "status" in reply) {
        const status = reply.status as AvailabilityReason;
        const isAvailable = status === "available";
        return [isAvailable, status];
      }

      return [false, "unknownUnavailable"];
    } catch (err) {
      this.debug(`Availability check failed: ${err}`);
      return [false, "unknownUnavailable"];
    }
  }

  /**
   * Shutdown the model and release resources.
   */
  async shutdown(): Promise<void> {
    if (this.backend) {
      await this.backend.shutdown();
      this.backend = undefined;
    }
  }

  private async ensureBackend(): Promise<void> {
    if (this.backend) return;

    // Try FM CLI first
    try {
      this.debug("Attempting to use FM CLI backend...");
      const manager = new FmProcessManager(this.options.socketPath);
      const proc = await manager.spawn();
      const { FmSocketClient } = await import("../fm/FmSocketClient.js");
      const client = new FmSocketClient(proc.socketPath);
      await client.connect();

      this.backend = new UnifiedBackend({
        kind: "fm",
        fmClient: client,
        processManager: manager,
        debug: this.debug,
      });
      this.debug("FM CLI backend initialized");
      return;
    } catch (err) {
      this.debug(`FM CLI backend failed: ${err}`);
    }

    // Fall back to helper backend
    const helperPath = this.options.helperPath || this.findHelperPath();
    if (!helperPath) {
      throw new Error(
        "Could not find afm-fm-helper binary. " +
          "Please provide helperPath option or install the helper."
      );
    }

    this.debug(`Using helper backend at ${helperPath}`);
    const helperManager = new HelperProcessManager(helperPath, undefined, this.debug);
    this.backend = await UnifiedBackend.createHelper(helperManager, this.debug);
  }

  private findHelperPath(): string | undefined {
    if (process.env.AFM_JS_HELPER_PATH) {
      return process.env.AFM_JS_HELPER_PATH;
    }

    const commonPaths = [
      "/opt/homebrew/opt/afm-js/libexec/afm-fm-helper",
      "/usr/local/opt/afm-js/libexec/afm-fm-helper",
      "/opt/homebrew/bin/afm-fm-helper",
      "/usr/local/bin/afm-fm-helper",
      "./helper/.build/release/afm-fm-helper",
    ];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    for (const path of commonPaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return undefined;
  }
}

/**
 * A session for interacting with the language model.
 * Mirrors python-apple-fm-sdk's LanguageModelSession class.
 */
export class LanguageModelSession {
  private backend?: UnifiedBackend;
  private sessionId?: string;
  private instructions?: string;
  private backendType: ModelBackendType;
  private temperature?: number;
  private maxTokens?: number;
  private seed?: number;
  private debug: (msg: string) => void;
  private isShutdown = false;

  constructor(options: LanguageModelSessionOptions = {}) {
    this.instructions = options.instructions;
    this.backendType = options.backend ?? "onDevice";
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.seed = options.seed;
    this.debug =
      typeof options.debug === "function"
        ? options.debug
        : options.debug
          ? (msg: string) => console.debug(`[LanguageModelSession] ${msg}`)
          : () => {};

    // Initialize backend if options provided
    if (options.socketPath || options.helperPath) {
      this.initializeBackend(options);
    }
  }

  private async initializeBackend(options: LanguageModelSessionOptions): Promise<void> {
    // Try FM CLI first
    if (options.socketPath) {
      try {
        const manager = new FmProcessManager(options.socketPath);
        const proc = await manager.spawn();
        const { FmSocketClient } = await import("../fm/FmSocketClient.js");
        const client = new FmSocketClient(proc.socketPath);
        await client.connect();

        this.backend = new UnifiedBackend({
          kind: "fm",
          fmClient: client,
          processManager: manager,
          debug: this.debug,
        });
        return;
      } catch (err) {
        this.debug(`FM CLI backend failed: ${err}`);
      }
    }

    // Fall back to helper
    if (options.helperPath) {
      const helperManager = new HelperProcessManager(options.helperPath, undefined, this.debug);
      this.backend = await UnifiedBackend.createHelper(helperManager, this.debug);
    }
  }

  /**
   * Generate a response to a prompt.
   * Mirrors python-apple-fm-sdk's LanguageModelSession.respond() method.
   */
  async respond(prompt: string): Promise<ModelResponse>;
  /**
   * Generate a structured response using guided generation.
   * Mirrors python-apple-fm-sdk's LanguageModelSession.respond(prompt, generating=Type) pattern.
   */
  async respond<T extends object>(prompt: string, generating: new () => T): Promise<T>;
  // Implementation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async respond<T>(prompt: string, generating?: new () => T): Promise<ModelResponse | T> {
    if (this.isShutdown) {
      throw new Error("Session has been shutdown");
    }

    await this.ensureBackend();

    const reply = await this.backend!.request({
      op: "respond",
      prompt,
      instructions: this.instructions,
      backend: this.backendType === "privateCloudCompute" ? "pcc" : "on_device",
      options: {
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        seed: this.seed,
      },
    });

    if ("ok" in reply && reply.ok === true && "content" in reply) {
      const content = reply.content;

      // If generating a type, attempt to parse JSON into that type
      if (generating) {
        try {
          const parsed = JSON.parse(content);
          const instance = new generating() as object;
          Object.assign(instance, parsed);
          return instance as T;
        } catch (err) {
          throw new Error(`Failed to parse response as ${generating.name}: ${err}`);
        }
      }

      return {
        content,
        finishReason: reply.finishReason,
        usage: reply.usage,
      };
    }

    if ("error" in reply) {
      throw this.errorFromReply(reply.error);
    }

    throw new Error("Unexpected reply from backend");
  }

  /**
   * Stream a response to a prompt.
   * Mirrors python-apple-fm-sdk's LanguageModelSession.stream_response() method.
   */
  async *streamResponse(prompt: string): AsyncIterable<ResponseChunk> {
    if (this.isShutdown) {
      throw new Error("Session has been shutdown");
    }

    await this.ensureBackend();

    const stream = this.backend!.streamRequest({
      op: "stream",
      prompt,
      instructions: this.instructions,
      backend: this.backendType === "privateCloudCompute" ? "pcc" : "on_device",
      options: {
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        seed: this.seed,
      },
    });

    for await (const frame of stream) {
      // Error frame
      if ("ok" in frame && frame.ok === false) {
        throw this.errorFromReply(frame.error);
      }

      // Delta frame
      if (frame.event === "delta") {
        yield {
          text: frame.text,
          isFinal: false,
        };
      }

      // Done frame
      if (frame.event === "done") {
        yield {
          text: "",
          isFinal: true,
          finishReason: frame.finishReason,
          usage: frame.usage,
        };
        return;
      }
    }
  }

  /**
   * Shutdown the session and release resources.
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;
    if (this.backend) {
      await this.backend.shutdown();
      this.backend = undefined;
    }
  }

  private async ensureBackend(): Promise<void> {
    if (this.backend) return;

    // Auto-detect backend
    this.debug("Auto-detecting backend...");

    // Try FM CLI first
    try {
      const manager = new FmProcessManager();
      const proc = await manager.spawn();
      const { FmSocketClient } = await import("../fm/FmSocketClient.js");
      const client = new FmSocketClient(proc.socketPath);
      await client.connect();

      this.backend = new UnifiedBackend({
        kind: "fm",
        fmClient: client,
        processManager: manager,
        debug: this.debug,
      });
      this.debug("FM CLI backend initialized");
      return;
    } catch (err) {
      this.debug(`FM CLI backend failed: ${err}`);
    }

    // Fall back to helper
    const helperPath = this.findHelperPath();
    if (!helperPath) {
      throw new Error(
        "Could not find afm-fm-helper binary. " +
          "Please provide helperPath option to LanguageModelSession constructor."
      );
    }

    this.debug(`Using helper backend at ${helperPath}`);
    const helperManager = new HelperProcessManager(helperPath, undefined, this.debug);
    this.backend = await UnifiedBackend.createHelper(helperManager, this.debug);
  }

  private findHelperPath(): string | undefined {
    if (process.env.AFM_JS_HELPER_PATH) {
      return process.env.AFM_JS_HELPER_PATH;
    }

    const commonPaths = [
      "/opt/homebrew/opt/afm-js/libexec/afm-fm-helper",
      "/usr/local/opt/afm-js/libexec/afm-fm-helper",
      "/opt/homebrew/bin/afm-fm-helper",
      "/usr/local/bin/afm-fm-helper",
      "./helper/.build/release/afm-fm-helper",
    ];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    for (const path of commonPaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private errorFromReply(error: { kind: string; reason?: string; message: string }): any {
    // Import AfmError dynamically to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AfmError } = require("../errors/AfmError.js") as typeof import("../errors/AfmError.js");

    switch (error.kind) {
      case "pccUnavailable":
        return AfmError.classify({ kind: "pccUnavailable", reason: error.reason ?? error.message });
      case "pccQuotaExceeded":
        return AfmError.classify({ kind: "pccQuotaExceeded" });
      case "pccNetworkFailure":
        return AfmError.classify({ kind: "pccNetworkFailure", message: error.message });
      case "decodingFailure":
        return AfmError.classify({ kind: "decodingFailure", message: error.message });
      default:
        return AfmError.classify({ kind: "unknown", message: error.message });
    }
  }
}
