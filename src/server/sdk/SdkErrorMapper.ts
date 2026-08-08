// ============================================================================
// SdkErrorMapper.ts — Map javascript-apple-fm-sdk errors to typed AfmError variants.
// ============================================================================

import {
  AssetsUnavailableError,
  ConcurrentRequestsError,
  DecodingFailureError,
  ExceededContextWindowSizeError,
  FoundationModelsError,
  GuardrailViolationError,
  RateLimitedError,
  RefusalError,
  ToolCallError,
  UnsupportedGuideError,
  UnsupportedLanguageOrLocaleError,
} from "javascript-apple-fm-sdk";
import type { AfmError } from "../errors/AfmError.js";

export const SdkErrorMapper = {
  fromError(err: unknown): AfmError | null {
    if (!(err instanceof FoundationModelsError)) {
      return null;
    }

    if (err instanceof GuardrailViolationError) {
      return { kind: "guardrailViolation" };
    }
    if (err instanceof RefusalError) {
      return { kind: "refusal", explanation: err.message };
    }
    if (err instanceof ExceededContextWindowSizeError) {
      return { kind: "contextOverflow" };
    }
    if (err instanceof RateLimitedError) {
      return { kind: "rateLimited" };
    }
    if (err instanceof ConcurrentRequestsError) {
      return { kind: "concurrentRequest" };
    }
    if (err instanceof AssetsUnavailableError) {
      return { kind: "assetsUnavailable" };
    }
    if (err instanceof UnsupportedGuideError) {
      return { kind: "unsupportedGuide" };
    }
    if (err instanceof UnsupportedLanguageOrLocaleError) {
      return { kind: "unsupportedLanguage", message: err.message };
    }
    if (err instanceof DecodingFailureError) {
      return { kind: "decodingFailure", message: err.message };
    }
    if (err instanceof ToolCallError) {
      return { kind: "toolExecution", message: err.message };
    }

    return { kind: "unknown", message: err.message };
  },
} as const;