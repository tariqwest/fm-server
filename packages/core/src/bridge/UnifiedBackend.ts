// ============================================================================
// UnifiedBackend.ts — Abstraction over afm-fm-helper (JSON stdin/stdout) and
// /usr/bin/fm serve (HTTP over Unix Domain Socket). Presents the same API
// regardless of which backend is in use.
// ============================================================================

import { FmSocketClient, FmProcessManager } from "../fm/index.js";
import { AfmError } from "../errors/AfmError.js";
import {
  HelperProcess,
  type HelperRequest,
  type HelperReply,
  type HelperOkAvailability,
  type HelperOkOpenSession,
  type HelperOkRespond,
  type HelperOkSimple,
  type HelperStreamFrame,
} from "./HelperProcess.js";

export type BackendKind = "fm" | "helper";

export interface UnifiedBackendOptions {
  kind: BackendKind;
  /** For fm backend */
  fmClient?: FmSocketClient;
  fmProcessManager?: FmProcessManager;
  /** For helper backend */
  helperProcess?: HelperProcess;
  debug?: (msg: string) => void;
}

/**
 * Adapts FM CLI's OpenAI-compatible HTTP API to the internal helper wire
 * protocol. FM is stateless, so we simulate sessions locally.
 */
export class UnifiedBackend {
  private kind: BackendKind;
  private fmClient?: FmSocketClient;
  private fmManager?: FmProcessManager;
  private helperProcess?: HelperProcess;
  private debug: (msg: string) => void;
  private nextId = 0;
  private shuttingDown = false;

  // For FM backend: simulate sessions (FM is stateless)
  private sessionCounter = 0;

  constructor(opts: UnifiedBackendOptions) {
    this.kind = opts.kind;
    this.fmClient = opts.fmClient;
    this.fmManager = opts.fmProcessManager;
    this.helperProcess = opts.helperProcess;
    this.debug = opts.debug ?? (() => {});
  }

  static async createFm(socketPath?: string, debug?: (msg: string) => void): Promise<UnifiedBackend> {
    const manager = new FmProcessManager(socketPath);
    const proc = await manager.spawn();
    const client = new FmSocketClient(proc.socketPath);
    await client.connect();

    return new UnifiedBackend({
      kind: "fm",
      fmClient: client,
      fmProcessManager: manager,
      debug,
    });
  }

  static createHelper(helper: HelperProcess, debug?: (msg: string) => void): UnifiedBackend {
    return new UnifiedBackend({
      kind: "helper",
      helperProcess: helper,
      debug,
    });
  }

  getKind(): BackendKind {
    return this.kind;
  }

  /** Send a unary request, await reply */
  async request(req: HelperRequest, timeoutMs = 60_000): Promise<HelperReply> {
    if (this.shuttingDown) {
      throw new Error("Backend is shutting down");
    }

    const id = `r${++this.nextId}`;

    if (this.kind === "fm" && this.fmClient) {
      return this.fmRequest(id, req, timeoutMs);
    }

    // Helper backend: delegate to HelperProcess
    if (this.helperProcess) {
      return this.helperProcess.request(req, timeoutMs);
    }

    throw new Error("No backend available in UnifiedBackend");
  }

  /** Send a streaming request */
  streamRequest(req: HelperRequest, signal?: AbortSignal): AsyncIterable<HelperStreamFrame> {
    if (this.shuttingDown) {
      throw new Error("Backend is shutting down");
    }

    const id = `r${++this.nextId}`;

    if (this.kind === "fm" && this.fmClient) {
      return this.fmStreamRequest(id, req, signal);
    }

    // Helper backend: delegate to HelperProcess
    if (this.helperProcess) {
      return this.helperProcess.streamRequest(req, signal);
    }

    throw new Error("No backend available in UnifiedBackend");
  }

  /** Convenience: request with automatic error conversion */
  async call<T extends HelperReply>(req: HelperRequest): Promise<T & { ok: true }> {
    const reply = await this.request(req);

    if ("ok" in reply && reply.ok === true) {
      return reply as T & { ok: true };
    }

    if (!("ok" in reply) || reply.ok !== false) {
      throw new Error(`UnifiedBackend.call: unexpected non-unary reply for op '${req.op}'`);
    }

    const err = reply.error;
    switch (err.kind) {
      case "pccUnavailable":
        throw AfmError.classify({ kind: "pccUnavailable", reason: err.reason ?? err.message });
      case "pccQuotaExceeded":
        throw AfmError.classify({ kind: "pccQuotaExceeded" });
      case "pccNetworkFailure":
        throw AfmError.classify({ kind: "pccNetworkFailure", message: err.message });
      case "decodingFailure":
        throw AfmError.classify({ kind: "decodingFailure", message: err.message });
      default:
        throw AfmError.classify({ kind: "unknown", message: err.message });
    }
  }

  /** Shutdown the backend */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.kind === "fm") {
      this.fmClient?.close();
      await this.fmManager?.shutdown();
    } else if (this.helperProcess) {
      await this.helperProcess.shutdown();
    }
  }

  // ============================================================================
  // FM Backend Implementation
  // ============================================================================

  private async fmRequest(
    id: string,
    req: HelperRequest,
    _timeoutMs: number,
  ): Promise<HelperReply> {
    if (!this.fmClient) {
      throw new Error("FM client not initialized");
    }

    switch (req.op) {
      case "availability": {
        // Query /v1/models to check availability
        const response = await this.fmClient.request("GET", "/v1/models");
        const body = JSON.parse(response.body.toString("utf-8"));

        const hasSystem = body.data?.some((m: { id: string }) => m.id === "system");
        const hasPcc = body.data?.some((m: { id: string }) => m.id === "pcc");

        let status: HelperOkAvailability["status"] = "unknownUnavailable";
        if (hasSystem || hasPcc) {
          status = "available";
        }

        const result: HelperOkAvailability = {
          ok: true,
          id,
          status,
        };
        return result;
      }

      case "openSession": {
        // FM is stateless, just return a synthetic session ID
        const sessionId = `s${++this.sessionCounter}`;
        const result: HelperOkOpenSession = {
          ok: true,
          id,
          session: sessionId,
        };
        return result;
      }

      case "respond": {
        // Non-streaming chat completion
        if (!req.prompt) {
          return this.makeError(id, "decodingFailure", "Missing prompt");
        }

        const model = req.backend === "pcc" ? "pcc" : "system";
        const response = await this.fmClient.request("POST", "/v1/chat/completions", {
          model,
          messages: [{ role: "user", content: req.prompt }],
          temperature: req.options?.temperature,
          max_tokens: req.options?.maxTokens,
          seed: req.options?.seed,
        });

        if (response.statusCode >= 400) {
          return this.handleFmError(id, response);
        }

        const body = JSON.parse(response.body.toString("utf-8"));
        const choice = body.choices?.[0];
        const message = choice?.message;

        const result: HelperOkRespond = {
          ok: true,
          id,
          content: message?.content ?? "",
          finishReason: choice?.finish_reason ?? "stop",
          usage: {
            promptTokens: body.usage?.prompt_tokens ?? 0,
            completionTokens: body.usage?.completion_tokens ?? 0,
            totalTokens: body.usage?.total_tokens ?? 0,
          },
        };
        return result;
      }

      case "closeSession":
      case "shutdown": {
        // No-op for stateless FM
        const result: HelperOkSimple = { ok: true, id };
        return result;
      }

      default:
        return this.makeError(id, "unknown", `Unsupported op: ${req.op}`);
    }
  }

  private async *fmStreamRequest(
    id: string,
    req: HelperRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<HelperStreamFrame> {
    if (!this.fmClient) {
      throw new Error("FM client not initialized");
    }

    if (req.op !== "stream") {
      throw new Error(`fmStreamRequest only supports 'stream' op, got ${req.op}`);
    }

    if (!req.prompt) {
      yield this.makeStreamError(id, "decodingFailure", "Missing prompt");
      return;
    }

    const model = req.backend === "pcc" ? "pcc" : "system";
    const abortController = new AbortController();

    if (signal) {
      signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }

    try {
      const stream = this.fmClient.streamSSE(
        "POST",
        "/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: req.prompt }],
          stream: true,
          temperature: req.options?.temperature,
          max_tokens: req.options?.maxTokens,
          seed: req.options?.seed,
        },
      );

      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          return;
        }

        const delta = chunk as {
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };

        const content = delta.choices?.[0]?.delta?.content;
        const finishReason = delta.choices?.[0]?.finish_reason;

        if (content) {
          const frame: HelperStreamFrame = {
            id,
            event: "delta",
            text: content,
          };
          yield frame;
        }

        if (delta.usage) {
          usage = {
            promptTokens: delta.usage.prompt_tokens,
            completionTokens: delta.usage.completion_tokens,
            totalTokens: delta.usage.total_tokens,
          };
        }

        if (finishReason) {
          const doneFrame: HelperStreamFrame = {
            id,
            event: "done",
            finishReason,
            usage,
          };
          yield doneFrame;
          return;
        }
      }

      // If we reached here without a done frame, synthesize one
      const doneFrame: HelperStreamFrame = {
        id,
        event: "done",
        finishReason: "stop",
        usage,
      };
      yield doneFrame;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield this.makeStreamError(id, "unknown", message);
    }
  }

  private handleFmError(id: string, response: { statusCode: number; body: Buffer }): HelperReply {
    const bodyText = response.body.toString("utf-8");
    let errorKind = "unknown";
    let message = `HTTP ${response.statusCode}`;

    try {
      const body = JSON.parse(bodyText);
      message = body.error?.message ?? message;

      // Detect PCC errors from error messages or codes
      if (message.includes("quota") || message.includes("quotaLimitReached")) {
        errorKind = "pccQuotaExceeded";
      } else if (message.includes("network") || message.includes("networkFailure")) {
        errorKind = "pccNetworkFailure";
      } else if (message.includes("unavailable") || message.includes("deviceNotEligible")) {
        errorKind = "pccUnavailable";
      }
    } catch {
      // Use defaults
    }

    return {
      ok: false,
      id,
      error: { kind: errorKind, message },
    };
  }

  private makeError(id: string, kind: string, message: string): HelperReply {
    return {
      ok: false,
      id,
      error: { kind, message },
    };
  }

  private makeStreamError(id: string, kind: string, message: string): HelperStreamFrame {
    return {
      ok: false,
      id,
      error: { kind, message },
    };
  }
}
