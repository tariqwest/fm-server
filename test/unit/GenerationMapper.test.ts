import { describe, it, expect } from "bun:test";
import { SamplingModeType } from "javascript-apple-fm-sdk";
import { toGenerationOptions } from "../../src/server/sdk/GenerationMapper.js";

describe("GenerationMapper", () => {
  it("returns undefined when no params are provided", () => {
    expect(toGenerationOptions()).toBeUndefined();
    expect(toGenerationOptions({})).toBeUndefined();
  });

  it("maps temperature and max tokens", () => {
    const options = toGenerationOptions({ temperature: 0.7, maxTokens: 128 });
    expect(options?.temperature).toBe(0.7);
    expect(options?.maximumResponseTokens).toBe(128);
    expect(options?.toJSON()).toEqual({
      temperature: 0.7,
      maximum_response_tokens: 128,
    });
  });

  it("maps seed to random sampling mode", () => {
    const options = toGenerationOptions({ seed: 42 });
    expect(options?.sampling?.modeType).toBe(SamplingModeType.RANDOM);
    expect(options?.sampling?.seed).toBe(42);
  });
});