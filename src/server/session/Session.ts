// ============================================================================
// Session.ts — Per-request session wrapper. Dispatches to either the on-device
// InferenceService (javascript-apple-fm-sdk) or PccInferenceService (fm-access-pcc) based on
// the requested ModelBackend.
// ============================================================================

import type { LanguageModelSession } from "javascript-apple-fm-sdk";
import { AfmError } from "../errors/AfmError.js";
import type { ModelBackend } from "../backend/ModelBackend.js";
import {
  InferenceService,
  type InferenceRespondResult,
  type InferenceStreamEvent,
} from "../sdk/InferenceService.js";
import { PccInferenceService } from "../pcc/PccInferenceService.js";

export interface SessionOptions {
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

export type SessionRespondResult = InferenceRespondResult;

export class Session {
  private constructor(
    private readonly inference: InferenceService | null,
    private readonly sdkSession: LanguageModelSession | null,
    public readonly backend: ModelBackend,
    private readonly instructions?: string,
  ) {}

  static open(
    inference: InferenceService,
    backend: ModelBackend,
    instructions?: string,
  ): Session {
    if (backend === "privateCloudCompute") {
      // PCC sessions don't use the javascript-apple-fm-sdk LanguageModelSession.
      // fm-access-pcc drives fm serve / fm CLI per-call.
      return new Session(null, null, backend, instructions);
    }

    try {
      const sdkSession = inference.openSession(backend, instructions);
      return new Session(inference, sdkSession, backend, instructions);
    } catch (err) {
      throw AfmError.classify(err);
    }
  }

  async respond(prompt: string, options?: SessionOptions): Promise<SessionRespondResult> {
    if (this.backend === "privateCloudCompute") {
      return PccInferenceService.respond(prompt, this.instructions, options);
    }
    return this.inference!.respond(this.sdkSession!, prompt, options);
  }

  async *stream(
    prompt: string,
    options?: SessionOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<InferenceStreamEvent, void, void> {
    if (this.backend === "privateCloudCompute") {
      yield* PccInferenceService.stream(prompt, this.instructions, options, signal);
      return;
    }
    yield* this.inference!.stream(this.sdkSession!, prompt, options, signal);
  }

  async close(): Promise<void> {
    if (this.sdkSession) {
      try {
        this.sdkSession.release();
      } catch {
        // Best-effort: a failed close is non-fatal.
      }
    }
  }
}

export type StreamEvent = InferenceStreamEvent;
