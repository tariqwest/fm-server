// ============================================================================
// GenerationMapper.ts — Map OpenAI generation params to javascript-apple-fm-sdk options.
// ============================================================================

import { GenerationOptions, SamplingMode } from "javascript-apple-fm-sdk";

export interface OpenAIGenerationParams {
  temperature?: number;
  maxTokens?: number;
  seed?: number;
}

export function toGenerationOptions(
  params?: OpenAIGenerationParams,
): GenerationOptions | undefined {
  if (params == null) return undefined;

  const hasTemperature = params.temperature !== undefined;
  const hasMaxTokens = params.maxTokens !== undefined;
  const hasSeed = params.seed !== undefined;

  if (!hasTemperature && !hasMaxTokens && !hasSeed) {
    return undefined;
  }

  return new GenerationOptions({
    temperature: params.temperature,
    maximumResponseTokens: params.maxTokens,
    sampling: hasSeed ? SamplingMode.random({ seed: params.seed }) : undefined,
  });
}