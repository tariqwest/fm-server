import { describe, it, expect } from "bun:test";
import { ChatRequestValidator } from "../../src/server/validators/ChatRequestValidator.js";

describe("ChatRequestValidator", () => {
  it("accepts pcc model", () => {
    const failure = ChatRequestValidator.validate({
      model: "pcc",
      messages: [{ role: "user", content: "hi" }],
    } as never);

    expect(failure).toBeNull();
  });

  it("accepts system model", () => {
    const failure = ChatRequestValidator.validate({
      model: "system",
      messages: [{ role: "user", content: "hi" }],
    } as never);

    expect(failure).toBeNull();
  });

  it("rejects unknown model IDs", () => {
    const failure = ChatRequestValidator.validate({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    } as never);

    expect(failure).toEqual({ kind: "invalidModel", model: "gpt-4" });
    expect(ChatRequestValidator.message(failure!)).toContain("does not exist");
  });
});
