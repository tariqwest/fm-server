// ============================================================================
// ModelProvider.ts — SystemLanguageModel lifecycle, availability, token count.
// ============================================================================

import {
  isNativeAvailable,
  SystemLanguageModel,
  SystemLanguageModelUnavailableReason,
} from "javascript-apple-fm-sdk";
import type { ModelAvailability } from "../backend/ModelAvailability.js";

export class ModelProvider {
  private readonly model: SystemLanguageModel;

  private constructor(model: SystemLanguageModel) {
    this.model = model;
  }

  static create(): ModelProvider {
    if (!isNativeAvailable()) {
      throw new Error(
        "javascript-apple-fm-sdk native bindings are not available on this platform",
      );
    }
    return new ModelProvider(new SystemLanguageModel());
  }

  get availability(): ModelAvailability {
    const [available, reason] = this.model.isAvailable();
    if (available) return "available";
    return mapUnavailableReason(reason);
  }

  get contextSize(): number {
    return this.model.getContextSize();
  }

  get sdkModel(): SystemLanguageModel {
    return this.model;
  }

  async tokenCountForPrompt(text: string, instructions?: string): Promise<number> {
    if (instructions) {
      return this.model.tokenCount(undefined, { instructions });
    }
    return this.model.tokenCount(text);
  }

  async tokenCountForInstructions(instructions: string): Promise<number> {
    return this.model.tokenCount(undefined, { instructions });
  }

  async tokenCountForResponse(text: string): Promise<number> {
    return this.model.tokenCount(text);
  }

  release(): void {
    this.model.release();
  }
}

function mapUnavailableReason(
  reason: SystemLanguageModelUnavailableReason | undefined,
): ModelAvailability {
  switch (reason) {
    case SystemLanguageModelUnavailableReason.APPLE_INTELLIGENCE_NOT_ENABLED:
      return "appleIntelligenceNotEnabled";
    case SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE:
      return "deviceNotEligible";
    case SystemLanguageModelUnavailableReason.MODEL_NOT_READY:
      return "modelNotReady";
    default:
      return "unknownUnavailable";
  }
}