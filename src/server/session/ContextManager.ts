// ============================================================================
// ContextManager.ts — Convert an OpenAI multi-turn `messages` array into
// (a) instructions for the session and (b) a single prompt string for the
// final turn.
//
// Port-of-record for `Sources/ContextManager.swift`. The Swift impl uses
// FoundationModels' native `Transcript` API (Instructions / Prompt / Response
// entries) to reconstruct session state without re-inferring history. fm-server's
// helper protocol doesn't yet expose Transcript entries on the wire, so we
// folded history into a textual conversation block. This keeps multi-turn
// working at correct semantics today and leaves a clean upgrade path: when
// the helper grows an `openSession` op that accepts transcript entries, this
// module is the one place that changes.
// ============================================================================

import type { OpenAIMessage, OpenAITool, ResponseFormat } from "../openai/index.js";
import { ToolCallHandler } from "../tools/ToolCallHandler.js";
import { messageText } from "../openai/index.js";

export interface MakeSessionInput {
  messages: OpenAIMessage[];
  tools?: OpenAITool[] | null;
  /** When true, tool-output instructions are injected into the system prompt. */
  injectToolInstructions?: boolean;
  /**
   * If set, append a JSON-output contract to the instructions. M3 implements
   * structured outputs by prompt-engineering the schema into the system
   * message and post-processing with JSONFenceStripper. The full native
   * GenerationSchema path will land when the helper exposes a respondWithSchema
   * op (planned for M4).
   */
  responseFormat?: ResponseFormat;
}

export interface PreparedSession {
  /** The instructions string to attach to the session (may be empty). */
  instructions: string;
  /** The single user prompt for the final turn. */
  finalPrompt: string;
  /** How many history messages were folded in (excluding the final user turn). */
  historyCount: number;
}

const ROLE_PREFIX: Record<string, string> = {
  user: "User",
  assistant: "Assistant",
  tool: "Tool result",
  system: "System",
};

/**
 * Build a prepared session from OpenAI messages.
 *
 * Rules:
 * - The system message (if any) becomes the base of `instructions`.
 * - Tool instructions are appended when tools are provided.
 * - Prior user/assistant/tool messages are formatted as a transcript block
 *   appended to the system prompt under a "Conversation so far" header.
 * - The final user/tool message becomes `finalPrompt`. apfel-plus's logic for
 *   handling a trailing `role: "tool"` message (auto-synthesise a follow-up
 *   prompt) is preserved.
 */
export function makeContext(input: MakeSessionInput): PreparedSession {
  const failure = pickValidationError(input);
  if (failure) throw new Error(failure);

  const messages = input.messages;
  const system = messages.find((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  if (conversation.length === 0) {
    throw new Error("ContextManager: no non-system messages provided");
  }

  // History = everything except the final turn. Final turn drives the prompt.
  const last = conversation.at(-1);
  if (!last) throw new Error("ContextManager: empty conversation slice");
  const history = conversation.slice(0, -1);

  // Compose the instructions block.
  const parts: string[] = [];
  if (system) {
    const sys = messageText(system);
    if (sys) parts.push(sys);
  }
  if (input.injectToolInstructions && input.tools && input.tools.length > 0) {
    const names = input.tools.map((t) => t.function.name);
    parts.push(ToolCallHandler.buildOutputFormatInstructions(names));
    const defs = input.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parametersJSON:
        t.function.parameters !== undefined ? JSON.stringify(t.function.parameters) : undefined,
    }));
    const fallback = ToolCallHandler.buildFallbackPrompt(defs);
    if (fallback) parts.push(fallback);
  }
  if (input.responseFormat) {
    const json = renderResponseFormatPrompt(input.responseFormat);
    if (json) parts.push(json);
  }
  if (history.length > 0) {
    parts.push("Conversation so far:");
    for (const m of history) {
      const role = ROLE_PREFIX[m.role] ?? m.role;
      const text = messageText(m);
      if (text) {
        parts.push(`${role}: ${text}`);
      } else if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        // Surface prior tool calls as readable history.
        const calls = m.tool_calls
          .map((c) => `${c.function.name}(${c.function.arguments})`)
          .join(", ");
        parts.push(`Assistant called tool(s): ${calls}`);
      }
    }
  }
  const instructions = parts.join("\n\n").trim();

  // Compose the final prompt.
  let finalPrompt: string;
  if (last.role === "tool") {
    // Apfel-plus parity: a trailing tool-result turn flips to a follow-up
    // ask. The tool output itself was already added to the history block.
    const toolText = messageText(last) ?? "";
    finalPrompt = toolText
      ? `Respond to the user based on this tool result: ${toolText}`
      : "Respond to the user based on the tool result above.";
  } else if (last.role === "user") {
    const text = messageText(last);
    if (!text) {
      throw new Error("ContextManager: final user message has no text content");
    }
    finalPrompt = text;
  } else {
    throw new Error(`ContextManager: final message has unsupported role '${last.role}'`);
  }

  return { instructions, finalPrompt, historyCount: history.length };
}

function renderResponseFormatPrompt(format: ResponseFormat): string {
  switch (format.type) {
    case "text":
      return "";
    case "json_object":
      return [
        "## Response format",
        "You must respond with valid JSON only.",
        "No markdown code fences, no explanation text, no preamble.",
        "Output raw JSON.",
      ].join("\n");
    case "json_schema": {
      const schemaText = format.json_schema.schema
        ? JSON.stringify(format.json_schema.schema, null, 2)
        : "(no schema provided)";
      const lines = [
        "## Response format",
        "You must respond with raw JSON that conforms strictly to this JSON Schema.",
        "No markdown code fences, no explanation text.",
      ];
      if (format.json_schema.name) {
        lines.push(`Schema name: ${format.json_schema.name}`);
      }
      if (format.json_schema.description) {
        lines.push(`Schema description: ${format.json_schema.description}`);
      }
      lines.push("Schema:");
      lines.push(schemaText);
      return lines.join("\n");
    }
  }
}

function pickValidationError(input: MakeSessionInput): string | null {
  if (input.messages.length === 0) return "messages must contain at least one message";
  // Mirror ChatRequestValidator's final-role rule.
  const last = input.messages.at(-1);
  if (!last) return "messages slice is empty";
  if (last.role !== "user" && last.role !== "tool") {
    return "Last message must have role 'user' or 'tool'";
  }
  return null;
}
