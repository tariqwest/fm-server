// ============================================================================
// ToolCallHandler.ts — Out-of-band tool-call detector + system-prompt
// injector. fm-server (like apfel-plus) does not use FoundationModels' native
// in-band tool invocation; instead we instruct the model to emit a specific
// JSON envelope in its text output, then parse it back here.
//
// Port of Sources/Core/ToolCallHandler.swift. The string-aware balanced-brace
// scanner and the two function-name shapes (`{"function":{"name":…}}` and
// `{"function":"…"}`) port verbatim.
// ============================================================================

export interface ToolDef {
  name: string;
  description?: string | undefined;
  parametersJSON?: string | undefined;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  argumentsString: string;
}

export const ToolCallHandler = {
  /**
   * Build output-format instructions only (no tool schemas). Always needed
   * when tools are present — tells the model HOW to respond.
   */
  buildOutputFormatInstructions(toolNames: readonly string[]): string {
    const hint = toolNames.length === 0 ? "" : ` (${toolNames.join(", ")})`;
    return `## Tool Calling Format\n${toolCallResponseFormat(hint)}`;
  },

  /**
   * Build text-based schema injection for tools. Always emitted today
   * (fm-server does not yet pass tools natively to the SDK).
   */
  buildFallbackPrompt(tools: readonly ToolDef[]): string {
    if (tools.length === 0) return "";
    return `Additional function schemas (text fallback):\n${serializedToolSchemas(tools)}`;
  },

  /**
   * Detect and parse tool calls from model output.
   * Returns `null` when the response is a normal text reply.
   *
   * Handles, in order: the whole response as-is; the content of any
   * ```json ... ``` code blocks; the balanced JSON object starting at
   * `{"tool_calls"`.
   */
  detectToolCall(response: string): ParsedToolCall[] | null {
    for (const candidate of extractCandidates(response)) {
      const direct = parseToolCallJSON(candidate);
      if (direct && direct.length > 0) return direct;

      const repaired = repairUnclosedBrackets(candidate);
      if (repaired) {
        const reparsed = parseToolCallJSON(repaired);
        if (reparsed && reparsed.length > 0) return reparsed;
      }
    }
    return null;
  },

  /**
   * Ensure an arguments string is valid JSON per OpenAI spec.
   * - Empty -> "{}"
   * - Already an object/array -> returned as-is
   * - Plain string -> wrapped as `{"value":"…"}` so consumers can always JSON-parse it.
   */
  ensureJSONArguments(s: string): string {
    const trimmed = s.trim();
    if (trimmed === "") return "{}";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return s;
    return JSON.stringify({ value: trimmed });
  },

  /** Strip a trailing `{"tool_calls": ...}` block off model text so it never leaks. */
  stripToolCallJSON(text: string): string {
    const marker = text.indexOf('{"tool_calls"');
    if (marker < 0) return text.trim();

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = marker; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return (text.slice(0, marker) + text.slice(i + 1)).trim();
        }
      }
    }
    return text.slice(0, marker).trim();
  },
} as const;

// MARK: - Private helpers

function toolCallResponseFormat(functionHint: string): string {
  return [
    `When you need to call a function${functionHint}, respond ONLY with this exact JSON (no other text before or after):`,
    '{"tool_calls": [{"id": "call_<unique>", "type": "function", "function": {"name": "<name>", "arguments": "<escaped_json_string>"}}]}',
    "",
    "Replace <unique> with a short unique string, <name> with the function name, and <escaped_json_string> with the arguments as a JSON-encoded string.",
  ].join("\n");
}

function serializedToolSchemas(tools: readonly ToolDef[]): string {
  const objects = tools.map((tool) => {
    const object: Record<string, unknown> = { name: tool.name };
    if (tool.description) object.description = tool.description;
    if (tool.parametersJSON) {
      try {
        object.parameters = JSON.parse(tool.parametersJSON);
      } catch {
        // Drop unparseable parameter schemas — same behaviour as Swift.
      }
    }
    return object;
  });
  return JSON.stringify(objects, null, 2);
}

function extractCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  // 2. Strip ```json ... ``` or ``` ... ``` code blocks.
  let remaining = text;
  while (true) {
    const startIdx = remaining.indexOf("```");
    if (startIdx < 0) break;
    const afterStart = startIdx + 3;
    // Skip optional `json` tag.
    let bodyStart = afterStart;
    if (remaining.slice(afterStart, afterStart + 5) === "json\n") {
      bodyStart = afterStart + 5;
    } else if (remaining.slice(afterStart, afterStart + 4) === "json") {
      bodyStart = afterStart + 4;
    }
    const endIdx = remaining.indexOf("```", bodyStart);
    if (endIdx < 0) break;
    candidates.push(remaining.slice(bodyStart, endIdx).trim());
    remaining = remaining.slice(endIdx + 3);
  }

  // 3. Balanced-JSON scan from `{"tool_calls"`. String-aware: braces inside
  //    quoted strings (e.g. an id containing '}') do not affect depth.
  const marker = text.indexOf('{"tool_calls"');
  if (marker >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let found = false;
    for (let i = marker; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(marker, i + 1));
          found = true;
          break;
        }
      }
    }
    if (!found) {
      candidates.push(text.slice(marker).trim());
    }
  }

  return candidates;
}

/**
 * Insert missing `]` characters before the outermost `}` when the model
 * forgot to close the `tool_calls` array. Returns null if no repair is
 * needed or the input doesn't look like a tool-call object.
 */
function repairUnclosedBrackets(json: string): string | null {
  const trimmed = json.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  let bracketDepth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of trimmed) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }
  if (bracketDepth <= 0) return null;

  const insertPos = trimmed.length - 1;
  return trimmed.slice(0, insertPos) + "]".repeat(bracketDepth) + trimmed.slice(insertPos);
}

function parseToolCallJSON(json: string): ParsedToolCall[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const raw = obj.tool_calls;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const result: ParsedToolCall[] = [];
  for (const call of raw) {
    if (!call || typeof call !== "object") continue;
    const c = call as Record<string, unknown>;
    if (typeof c.id !== "string") continue;

    let name: string | null = null;
    let rawArguments: unknown;
    const fn = c.function;
    if (fn && typeof fn === "object" && !Array.isArray(fn)) {
      const fnObj = fn as Record<string, unknown>;
      if (typeof fnObj.name === "string") {
        name = fnObj.name;
        rawArguments = fnObj.arguments;
      }
    } else if (typeof fn === "string") {
      // Upstream-fix shape: `{"function": "name", "arguments": "..."}`
      name = fn;
      rawArguments = c.arguments;
    }
    if (name == null) continue;

    let args: string;
    if (typeof rawArguments === "string") {
      args = ToolCallHandler.ensureJSONArguments(rawArguments);
    } else if (rawArguments !== undefined) {
      try {
        args = JSON.stringify(rawArguments);
      } catch {
        args = "{}";
      }
    } else {
      args = "{}";
    }
    result.push({ id: c.id, name, argumentsString: args });
  }
  return result.length === 0 ? null : result;
}
