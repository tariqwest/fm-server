// ============================================================================
// HelperProcess.ts — Spawns afm-fm-helper, multiplexes id-correlated
// newline-JSON requests over its stdin/stdout, and surfaces typed errors.
// One instance per server lifetime; sessions are scoped to the helper.
// ============================================================================

import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { AfmError } from "../errors/AfmError.js";

export interface HelperRequest {
  op:
    | "availability"
    | "openSession"
    | "respond"
    | "stream"
    | "closeSession"
    | "shutdown";
  backend?: "on_device" | "pcc";
  session?: string;
  prompt?: string;
  instructions?: string;
  options?: { temperature?: number; maxTokens?: number; seed?: number };
}

export interface HelperOkAvailability {
  ok: true;
  id: string;
  status:
    | "available"
    | "appleIntelligenceNotEnabled"
    | "deviceNotEligible"
    | "modelNotReady"
    | "unknownUnavailable";
}

export interface HelperOkOpenSession {
  ok: true;
  id: string;
  session: string;
}

export interface HelperOkRespond {
  ok: true;
  id: string;
  content: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface HelperOkSimple {
  ok: true;
  id: string;
}

export interface HelperErrorEnvelope {
  ok: false;
  id: string;
  error: { kind: string; reason?: string; message: string };
}

/** A streaming delta event: incremental text since the previous frame. */
export interface HelperStreamDelta {
  ok?: undefined;
  id: string;
  event: "delta";
  text: string;
}

/** Terminal frame for a stream request: emitted exactly once on success. */
export interface HelperStreamDone {
  ok?: undefined;
  id: string;
  event: "done";
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export type HelperStreamFrame = HelperStreamDelta | HelperStreamDone | HelperErrorEnvelope;

export type HelperReply =
  | HelperOkAvailability
  | HelperOkOpenSession
  | HelperOkRespond
  | HelperOkSimple
  | HelperErrorEnvelope
  | HelperStreamDelta
  | HelperStreamDone;

type PendingUnary = {
  kind: "unary";
  resolve: (value: HelperReply) => void;
  reject: (err: unknown) => void;
};

type PendingStream = {
  kind: "stream";
  push: (frame: HelperStreamFrame) => void;
  end: () => void;
};

type Pending = PendingUnary | PendingStream;

export interface HelperProcessOptions {
  /** Absolute path to the afm-fm-helper binary. */
  binaryPath: string;
  /** Debug log function; defaults to no-op. */
  debug?: (msg: string) => void;
}

export class HelperProcess {
  private readonly binaryPath: string;
  private readonly debug: (msg: string) => void;
  private child: ChildProcess | null = null;
  private buffer = "";
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private shuttingDown = false;

  constructor(opts: HelperProcessOptions) {
    this.binaryPath = opts.binaryPath;
    this.debug = opts.debug ?? (() => {});
  }

  /** Spawn the helper if not already running. Idempotent. */
  start(): void {
    if (this.child) return;
    this.debug(`spawning ${this.binaryPath}`);
    this.child = spawn(this.binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });

    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => this.debug(`helper stderr: ${chunk.trim()}`));

    this.child.on("exit", (code, signal) => {
      this.debug(`helper exited code=${code} signal=${signal}`);
      this.failAllPending(
        new Error(`afm-fm-helper exited unexpectedly (code=${code}, signal=${signal})`),
      );
      this.child = null;
    });

    this.child.on("error", (err) => {
      this.debug(`helper spawn error: ${err}`);
      this.failAllPending(err);
      this.child = null;
    });
  }

  /** Send a request, await its id-correlated reply. */
  async request(req: HelperRequest, timeoutMs = 60_000): Promise<HelperReply> {
    if (this.shuttingDown) {
      throw new Error("HelperProcess is shutting down");
    }
    this.start();
    if (!this.child?.stdin) {
      throw new Error("HelperProcess: stdin not available");
    }
    const id = `r${++this.nextId}`;
    const envelope = { id, ...req };
    const line = `${JSON.stringify(envelope)}\n`;

    const replyPromise = new Promise<HelperReply>((resolve, reject) => {
      this.pending.set(id, { kind: "unary", resolve, reject });
    });

    this.child.stdin.write(line);

    const timeoutPromise = (async () => {
      await delay(timeoutMs);
      throw new Error(`HelperProcess: request '${req.op}' timed out after ${timeoutMs}ms`);
    })();

    try {
      return await Promise.race([replyPromise, timeoutPromise]);
    } finally {
      this.pending.delete(id);
    }
  }

  /**
   * Send a streaming request. Returns an `AsyncIterable<HelperStreamFrame>`
   * that yields each helper frame as it arrives, terminating after the `done`
   * envelope or on an error envelope.
   */
  streamRequest(req: HelperRequest, signal?: AbortSignal): AsyncIterable<HelperStreamFrame> {
    if (this.shuttingDown) {
      throw new Error("HelperProcess is shutting down");
    }
    this.start();
    if (!this.child?.stdin) {
      throw new Error("HelperProcess: stdin not available");
    }
    const id = `r${++this.nextId}`;
    const envelope = { id, ...req };
    const line = `${JSON.stringify(envelope)}\n`;

    // Buffered async iterator: incoming frames are pushed; consumers `for await`
    // pulls. No backpressure on the helper -> we hold the buffer in memory, fine
    // for token-scale chat responses.
    type Resolver = (value: IteratorResult<HelperStreamFrame>) => void;
    const queue: HelperStreamFrame[] = [];
    const waiters: Resolver[] = [];
    let done = false;

    const pending: PendingStream = {
      kind: "stream",
      push: (frame) => {
        if (waiters.length > 0) {
          const r = waiters.shift();
          r?.({ value: frame, done: false });
        } else {
          queue.push(frame);
        }
        // Auto-end on terminal frames so callers don't have to drain.
        const isError = "ok" in frame && frame.ok === false;
        const isDone = "event" in frame && frame.event === "done";
        if (isDone || isError) {
          pending.end();
        }
      },
      end: () => {
        if (done) return;
        done = true;
        this.pending.delete(id);
        for (const w of waiters.splice(0)) w({ value: undefined, done: true });
      },
    };
    this.pending.set(id, pending);

    const onAbort = () => {
      pending.end();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    this.child.stdin.write(line);

    return {
      [Symbol.asyncIterator](): AsyncIterator<HelperStreamFrame> {
        return {
          next(): Promise<IteratorResult<HelperStreamFrame>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift() as HelperStreamFrame, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => waiters.push(resolve));
          },
          return(): Promise<IteratorResult<HelperStreamFrame>> {
            pending.end();
            signal?.removeEventListener("abort", onAbort);
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  /**
   * Convenience wrapper that throws a typed AfmError on an `ok: false` reply
   * and returns the success-path reply otherwise. Callers that need to
   * inspect the raw envelope can still use `request()` directly.
   */
  async call<T extends HelperReply>(req: HelperRequest): Promise<T & { ok: true }> {
    const reply = await this.request(req);
    if ("ok" in reply && reply.ok === true) {
      return reply as T & { ok: true };
    }
    if (!("ok" in reply) || reply.ok !== false) {
      // Stream frames shouldn't be reachable here; call() is unary-only.
      throw new Error(`HelperProcess.call: unexpected non-unary reply for op '${req.op}'`);
    }
    const err = reply.error;
    // Convert wire envelope to AfmError. The kinds align by name.
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

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (!this.child) return;
    try {
      await this.request({ op: "shutdown" }, 2_000).catch(() => {});
    } finally {
      this.child?.kill("SIGTERM");
      this.child = null;
    }
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let nlIdx: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard line-framing pattern
    while ((nlIdx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nlIdx);
      this.buffer = this.buffer.slice(nlIdx + 1);
      if (line.trim() === "") continue;
      let parsed: HelperReply;
      try {
        parsed = JSON.parse(line) as HelperReply;
      } catch (err) {
        this.debug(`helper: malformed reply line dropped (${err}): ${line}`);
        continue;
      }
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        this.debug(`helper: reply for unknown id ${parsed.id}, dropping`);
        continue;
      }
      if (pending.kind === "stream") {
        pending.push(parsed as HelperStreamFrame);
      } else {
        pending.resolve(parsed);
      }
    }
  }

  private failAllPending(err: unknown): void {
    for (const [, p] of this.pending) {
      if (p.kind === "stream") {
        p.end();
      } else {
        p.reject(err);
      }
    }
    this.pending.clear();
  }
}
