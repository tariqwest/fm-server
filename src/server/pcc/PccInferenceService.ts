// ============================================================================
// PccInferenceService.ts — Adapter for Private Cloud Compute inference via
// fm-access-pcc. Wraps fm-access-pcc's respond() and streaming respond() into the same
// InferenceRespondResult / InferenceStreamEvent shapes used by the on-device
// InferenceService so that Session and app.ts can treat both backends uniformly.
// ============================================================================

import { respond as fmRespond } from "fm-access-pcc";
import { FinishReason, FinishReasonResolver } from "../chat/FinishReasonResolver.js";
import type { InferenceRespondResult, InferenceStreamEvent } from "../sdk/InferenceService.js";

export interface PccRespondOptions {
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

/**
 * Rough token estimate for PCC responses. The fm CLI doesn't expose token
 * counts for PCC, so we use a ~4 chars/token heuristic (GPT-family average).
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export const PccInferenceService = {
  async respond(
    prompt: string,
    instructions?: string,
    options?: PccRespondOptions,
  ): Promise<InferenceRespondResult> {
    const result = await fmRespond(prompt, {
      model: "pcc",
      instructions,
      stream: false,
    });

    const promptTokens = estimateTokens(prompt + (instructions ?? ""));
    const completionTokens = estimateTokens(result.text);
    const finishReason = FinishReason.openAIValue(
      FinishReasonResolver.resolve({
        hasToolCalls: false,
        completionTokens,
        maxTokens: options?.maxTokens,
      }),
    );

    return {
      content: result.text,
      finishReason,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  },

  async *stream(
    prompt: string,
    instructions?: string,
    options?: PccRespondOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<InferenceStreamEvent, void, void> {
    const chunks = fmRespond(prompt, {
      model: "pcc",
      instructions,
      stream: true,
    });

    let fullContent = "";

    for await (const chunk of chunks) {
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }
      fullContent += chunk.text;
      yield { kind: "delta", text: chunk.text };
    }

    const promptTokens = estimateTokens(prompt + (instructions ?? ""));
    const completionTokens = estimateTokens(fullContent);
    const finishReason = FinishReason.openAIValue(
      FinishReasonResolver.resolve({
        hasToolCalls: false,
        completionTokens,
        maxTokens: options?.maxTokens,
      }),
    );

    yield {
      kind: "done",
      finishReason,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  },
} as const;
