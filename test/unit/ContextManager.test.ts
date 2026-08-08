import { describe, expect, test } from "bun:test";
import { makeContext } from "../../src/server/session/ContextManager.js";

describe("ContextManager.makeContext — basic shapes", () => {
  test("single-turn user message: empty instructions, prompt = content", () => {
    const out = makeContext({ messages: [{ role: "user", content: "hi" }] });
    expect(out.instructions).toBe("");
    expect(out.finalPrompt).toBe("hi");
    expect(out.historyCount).toBe(0);
  });

  test("system message becomes the base instructions", () => {
    const out = makeContext({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
    });
    expect(out.instructions).toBe("Be brief.");
    expect(out.finalPrompt).toBe("hi");
  });

  test("multi-turn history is folded into instructions under a transcript header", () => {
    const out = makeContext({
      messages: [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "what is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "and 5+5?" },
      ],
    });
    expect(out.finalPrompt).toBe("and 5+5?");
    expect(out.historyCount).toBe(2);
    expect(out.instructions).toContain("Be helpful.");
    expect(out.instructions).toContain("Conversation so far:");
    expect(out.instructions).toContain("User: what is 2+2?");
    expect(out.instructions).toContain("Assistant: 4");
  });
});

describe("ContextManager.makeContext — tool turns", () => {
  test("trailing role:'tool' message flips to a follow-up prompt", () => {
    const out = makeContext({
      messages: [
        { role: "user", content: "what is 7*7?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "calc", arguments: '{"expr":"7*7"}' } },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "49" },
      ],
    });
    expect(out.finalPrompt).toContain("49");
    expect(out.instructions).toContain("Assistant called tool(s): calc(");
  });

  test("tool instructions are injected when tools are present", () => {
    const out = makeContext({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description: "Search the web",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        },
      ],
      injectToolInstructions: true,
    });
    expect(out.instructions).toContain("Tool Calling Format");
    expect(out.instructions).toContain("(search)");
  });
});

describe("ContextManager.makeContext — validation", () => {
  test("empty messages throws", () => {
    expect(() => makeContext({ messages: [] })).toThrow();
  });

  test("trailing assistant message is rejected (last must be user or tool)", () => {
    expect(() =>
      makeContext({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hi back" },
        ],
      }),
    ).toThrow();
  });

  test("trailing user message with no text content throws", () => {
    expect(() => makeContext({ messages: [{ role: "user", content: null }] })).toThrow();
  });
});
