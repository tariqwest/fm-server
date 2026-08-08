import { describe, it, expect } from "bun:test";
import {
  GuardrailViolationError,
  RateLimitedError,
  RefusalError,
  GenerationError,
} from "javascript-apple-fm-sdk";
import { SdkErrorMapper } from "../../src/server/sdk/SdkErrorMapper.js";

describe("SdkErrorMapper", () => {
  it("maps guardrail violations", () => {
    expect(SdkErrorMapper.fromError(new GuardrailViolationError("blocked"))).toEqual({
      kind: "guardrailViolation",
    });
  });

  it("maps refusals", () => {
    expect(SdkErrorMapper.fromError(new RefusalError("no thanks"))).toEqual({
      kind: "refusal",
      explanation: "no thanks",
    });
  });

  it("maps rate limits", () => {
    expect(SdkErrorMapper.fromError(new RateLimitedError("slow down"))).toEqual({
      kind: "rateLimited",
    });
  });

  it("returns null for non-sdk errors", () => {
    expect(SdkErrorMapper.fromError(new Error("plain"))).toBeNull();
    expect(SdkErrorMapper.fromError(new GenerationError("generic"))).toEqual({
      kind: "unknown",
      message: "generic",
    });
  });
});