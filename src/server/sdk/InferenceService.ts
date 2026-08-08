// ============================================================================
// InferenceService.ts — In-process javascript-apple-fm-sdk adapter for chat inference.
// ============================================================================

import { LanguageModelSession } from "javascript-apple-fm-sdk";
import { FinishReason, FinishReasonResolver } from "../chat/FinishReasonResolver.js";
import { AfmError } from "../errors/AfmError.js";
import type { ModelBackend } from "../backend/ModelBackend.js";
import { toGenerationOptions, type OpenAIGenerationParams } from "./GenerationMapper.js";
import { ModelProvider } from "./ModelProvider.js";
import { SdkErrorMapper } from "./SdkErrorMapper.js";
import type { ModelAvailability } from "../backend/ModelAvailability.js";

export interface InferenceUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InferenceRespondResult {
  content: string;
  finishReason: string;
  usage: InferenceUsage;
}

export type InferenceStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "done"; finishReason: string; usage: InferenceUsage };

export class InferenceService {
  private readonly provider: ModelProvider;

  private constructor(provider: ModelProvider) {
    this.provider = provider;
  }

  static create(): InferenceService {
    return new InferenceService(ModelProvider.create());
  }

  get availability(): ModelAvailability {
    return this.provider.availability;
  }

  get contextSize(): number {
    return this.provider.contextSize;
  }

  async tokenCountForPrompt(text: string, instructions?: string): Promise<number> {
    return this.provider.tokenCountForPrompt(text, instructions);
  }

  openSession(
    backend: ModelBackend,
    instructions?: string,
  ): LanguageModelSession {
    return new LanguageModelSession({
      instructions,
      model: this.provider.sdkModel,
    });
  }

  async respond(
    session: LanguageModelSession,
    prompt: string,
    params?: OpenAIGenerationParams,
  ): Promise<InferenceRespondResult> {
    const options = toGenerationOptions(params);

    try {
      const content = await session.respond(prompt, { options });
      if (typeof content !== "string") {
        throw new Error("Expected text response from LanguageModelSession");
      }

      const promptTokens = await this.provider.tokenCountForPrompt(prompt);
      const completionTokens = await this.provider.tokenCountForResponse(content);
      const finishReason = FinishReason.openAIValue(
        FinishReasonResolver.resolve({
          hasToolCalls: false,
          completionTokens,
          maxTokens: params?.maxTokens,
        }),
      );

      return {
        content,
        finishReason,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
    } catch (err) {
      throw mapInferenceError(err);
    }
  }

  async *stream(
    session: LanguageModelSession,
    prompt: string,
    params?: OpenAIGenerationParams,
    signal?: AbortSignal,
  ): AsyncGenerator<InferenceStreamEvent, void, void> {
    const options = toGenerationOptions(params);
    let previousSnapshot = "";
    let completionTokens = 0;

    try {
      for await (const snapshot of session.streamResponse(prompt, options)) {
        if (signal?.aborted) {
          throw new Error("Request aborted");
        }

        const delta = snapshot.slice(previousSnapshot.length);
        previousSnapshot = snapshot;

        if (delta.length > 0) {
          yield { kind: "delta", text: delta };
        }
      }

      completionTokens = await this.provider.tokenCountForResponse(previousSnapshot);
      const finishReason = FinishReason.openAIValue(
        FinishReasonResolver.resolve({
          hasToolCalls: false,
          completionTokens,
          maxTokens: params?.maxTokens,
        }),
      );

      const promptTokens = await this.provider.tokenCountForPrompt(prompt);
      yield {
        kind: "done",
        finishReason,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
    } catch (err) {
      throw mapInferenceError(err);
    }
  }

  shutdown(): void {
    this.provider.release();
  }
}

function mapInferenceError(err: unknown): AfmError {
  const mapped = SdkErrorMapper.fromError(err);
  if (mapped) return mapped;
  return AfmError.classify(err);
}