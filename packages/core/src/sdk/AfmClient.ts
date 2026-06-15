// ============================================================================
// AfmClient.ts — High-level SDK client for Apple Foundation Models
//
// A user-friendly wrapper over UnifiedBackend that provides:
// - Simple API without wire protocol details
// - Auto-detection of best available backend (FM CLI vs helper)
// - Clean resource management
// - Fully typed requests and responses
//
// Usage:
//   const client = new AfmClient();
//   const response = await client.generate({ prompt: "Hello!" });
// ============================================================================

import { UnifiedBackend, HelperProcessManager, type HelperStreamFrame } from "../bridge/index.js";
import { FmProcessManager } from "../fm/FmProcessManager.js";
import { type AfmError } from "../errors/AfmError.js";

export type BackendType = "fm" | "helper" | "auto";

export interface AfmClientOptions {
  /** Backend to use. 'auto' tries FM CLI first, falls back to helper. Default: 'auto' */
  backend?: BackendType;
  /** Path to afm-fm-helper binary (required for 'helper' backend, optional for 'auto') */
  helperPath?: string;
  /** Custom socket path for FM CLI (auto-generated if not provided) */
  socketPath?: string;
  /** Enable debug logging. Can be a boolean or a custom debug function. */
  debug?: boolean | ((msg: string) => void);
}

export interface GenerateRequest {
  /** The prompt text to send to the model */
  prompt: string;
  /** Which model/backend to use: 'onDevice' (system) or 'privateCloudCompute' (PCC) */
  backend?: "onDevice" | "privateCloudCompute";
  /** System instructions/prompt */
  instructions?: string;
  /** Temperature (0-1). Higher = more random */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Seed for deterministic generation */
  seed?: number;
}

export interface GenerateResponse {
  /** The generated text content */
  content: string;
  /** Reason generation stopped: 'stop', 'length', etc. */
  finishReason: string;
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GenerationChunk {
  /** Incremental text delta (undefined for final chunk) */
  delta?: string;
  /** True if this is the final chunk */
  done: boolean;
  /** Reason generation stopped (only present when done) */
  finishReason?: string;
  /** Token usage statistics (only present when done) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export type AvailabilityStatus =
  | "available"
  | "appleIntelligenceNotEnabled"
  | "deviceNotEligible"
  | "modelNotReady"
  | "unknownUnavailable";

/**
 * High-level client for Apple Foundation Models.
 *
 * Automatically manages backend lifecycle and provides a clean, Promise-based API
 * for generating text with Apple's on-device and Private Cloud Compute models.
 *
 * @example
 * ```typescript
 * const client = new AfmClient();
 *
 * // Simple generation
 * const response = await client.generate({ prompt: "What is 2+2?" });
 * console.log(response.content);
 *
 * // Streaming generation
 * for await (const chunk of client.generateStream({ prompt: "Count to 5" })) {
 *   if (chunk.delta) process.stdout.write(chunk.delta);
 * }
 *
 * // Cleanup
 * await client.close();
 * ```
 */
export class AfmClient {
  private backend?: UnifiedBackend;
  private options: { backend: BackendType; helperPath: string; socketPath: string | undefined; debug: boolean | ((msg: string) => void) };
  private debug: (msg: string) => void;

  constructor(options: AfmClientOptions = {}) {
    this.options = {
      backend: options.backend ?? "auto",
      helperPath: options.helperPath ?? "",
      socketPath: options.socketPath,
      debug: options.debug ?? false,
    };

    this.debug =
      typeof this.options.debug === "function"
        ? this.options.debug
        : this.options.debug
          ? (msg: string) => console.debug(`[AfmClient] ${msg}`)
          : () => {};
  }

  /**
   * Check if Apple Foundation Models are available on this device.
   * This will auto-detect and initialize the backend if not already done.
   */
  async checkAvailability(): Promise<AvailabilityStatus> {
    await this.ensureBackend();
    const reply = await this.backend!.request({ op: "availability" });

    if ("ok" in reply && reply.ok === true && "status" in reply) {
      return reply.status as AvailabilityStatus;
    }

    return "unknownUnavailable";
  }

  /**
   * Generate a response (non-streaming).
   *
   * Sends a prompt to the model and waits for the complete response.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    await this.ensureBackend();

    const reply = await this.backend!.request({
      op: "respond",
      prompt: request.prompt,
      instructions: request.instructions,
      backend: request.backend === "privateCloudCompute" ? "pcc" : "on_device",
      options: {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        seed: request.seed,
      },
    });

    if ("ok" in reply && reply.ok === true && "content" in reply) {
      return {
        content: reply.content,
        finishReason: reply.finishReason,
        usage: reply.usage,
      };
    }

    // Error handling - convert to typed error
    if ("error" in reply) {
      throw this.errorFromReply(reply.error);
    }

    throw new Error("Unexpected reply from backend");
  }

  /**
   * Generate a response with streaming.
   *
   * Returns an async iterable that yields chunks as they arrive from the model.
   *
   * @example
   * ```typescript
   * for await (const chunk of client.generateStream({ prompt: "Hello" })) {
   *   if (chunk.delta) {
   *     process.stdout.write(chunk.delta);
   *   }
   *   if (chunk.done) {
   *     console.log("\n[Done]");
   *   }
   * }
   * ```
   */
  async *generateStream(request: GenerateRequest): AsyncIterable<GenerationChunk> {
    await this.ensureBackend();

    const stream = this.backend!.streamRequest({
      op: "stream",
      prompt: request.prompt,
      instructions: request.instructions,
      backend: request.backend === "privateCloudCompute" ? "pcc" : "on_device",
      options: {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        seed: request.seed,
      },
    });

    for await (const frame of stream) {
      yield this.convertFrameToChunk(frame);
    }
  }

  /**
   * Close the client and cleanup resources.
   *
   * Shuts down the backend and releases any held resources.
   * The client cannot be used after calling close().
   */
  async close(): Promise<void> {
    if (this.backend) {
      await this.backend.shutdown();
      this.backend = undefined;
    }
  }

  /** Ensure backend is initialized (auto-detect if needed) */
  private async ensureBackend(): Promise<void> {
    if (this.backend) return;

    if (this.options.backend === "fm" || this.options.backend === "auto") {
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
        if (this.options.backend === "fm") {
          throw new Error(`Failed to initialize FM CLI backend: ${err}`);
        }
        // Fall through to helper backend
      }
    }

    // Use helper backend
    if (this.options.backend === "helper" || this.options.backend === "auto") {
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
      return;
    }

    throw new Error(`Unknown backend type: ${this.options.backend}`);
  }

  /** Convert a helper wire frame to a user-friendly GenerationChunk */
  private convertFrameToChunk(frame: HelperStreamFrame): GenerationChunk {
    // Error frame
    if ("ok" in frame && frame.ok === false) {
      throw this.errorFromReply(frame.error);
    }

    // Delta frame
    if (frame.event === "delta") {
      return {
        delta: frame.text,
        done: false,
      };
    }

    // Done frame
    if (frame.event === "done") {
      return {
        done: true,
        finishReason: frame.finishReason,
        usage: frame.usage,
      };
    }

    // Unknown frame type
    throw new Error(`Unknown stream frame type`);
  }

  /** Convert error reply to typed AfmError */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private errorFromReply(error: { kind: string; reason?: string; message: string }): any {
    // Import AfmError dynamically to avoid circular dependencies at module load time
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

  /** Find helper binary in common locations */
  private findHelperPath(): string | undefined {
    // Check environment variable
    if (process.env.AFM_JS_HELPER_PATH) {
      return process.env.AFM_JS_HELPER_PATH;
    }

    // Check common paths
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
