// ============================================================================
// openai/index.ts — Zod-defined OpenAI wire schemas. The chat-completions
// request/response shapes drive both runtime validation and the inferred TS
// types so we never lose alignment between the two.
// ============================================================================

import { z } from "zod";

// MARK: - Content

const TextContentPart = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ImageContentPart = z.object({
  type: z.literal("image_url"),
  // fm-server rejects image content with a 400 (the on-device model is text-only),
  // but we accept the shape so the validator can give a clear error.
  image_url: z.object({ url: z.string() }).passthrough(),
});

export const ContentPart = z.union([TextContentPart, ImageContentPart]);
export type ContentPart = z.infer<typeof ContentPart>;

export const MessageContent = z.union([z.string(), z.array(ContentPart)]);
export type MessageContent = z.infer<typeof MessageContent>;

// MARK: - Tool call

export const ToolCallFunction = z.object({
  name: z.string(),
  arguments: z.string(),
});
export type ToolCallFunction = z.infer<typeof ToolCallFunction>;

export const ToolCall = z.object({
  id: z.string(),
  type: z.literal("function").default("function"),
  function: ToolCallFunction,
});
export type ToolCall = z.infer<typeof ToolCall>;

// MARK: - Messages

export const OpenAIMessage = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: MessageContent.nullable().optional(),
  refusal: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(ToolCall).optional(),
});
export type OpenAIMessage = z.infer<typeof OpenAIMessage>;

/**
 * Helper: extract the message's text content regardless of whether `content`
 * was sent as a plain string or as an array of typed parts. Returns null when
 * the message has no extractable text (e.g. tool-call assistant turn).
 */
export function messageText(m: OpenAIMessage): string | null {
  if (m.content == null) return null;
  if (typeof m.content === "string") return m.content;
  const parts = m.content
    .filter((p): p is z.infer<typeof TextContentPart> => p.type === "text")
    .map((p) => p.text);
  return parts.length === 0 ? null : parts.join("");
}

// MARK: - Tools (client-supplied)

export const OpenAIFunction = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.unknown().optional(),
});
export type OpenAIFunction = z.infer<typeof OpenAIFunction>;

export const OpenAITool = z.object({
  type: z.literal("function").default("function"),
  function: OpenAIFunction,
});
export type OpenAITool = z.infer<typeof OpenAITool>;

// MARK: - Tool choice (`auto` | `none` | `required` | `{ type: "function", function: { name } }`)

export const ToolChoice = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);
export type ToolChoice = z.infer<typeof ToolChoice>;

// MARK: - Response format

export const JSONSchemaSpec = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  schema: z.unknown().optional(),
  strict: z.boolean().optional(),
});
export type JSONSchemaSpec = z.infer<typeof JSONSchemaSpec>;

export const ResponseFormat = z.union([
  z.object({ type: z.literal("text") }),
  z.object({ type: z.literal("json_object") }),
  z.object({ type: z.literal("json_schema"), json_schema: JSONSchemaSpec }),
]);
export type ResponseFormat = z.infer<typeof ResponseFormat>;

// MARK: - Stream options

export const StreamOptions = z.object({
  include_usage: z.boolean().optional(),
});
export type StreamOptions = z.infer<typeof StreamOptions>;

// MARK: - Chat completion request

export const ChatCompletionRequest = z.object({
  model: z.string(),
  messages: z.array(OpenAIMessage),
  stream: z.boolean().optional(),
  stream_options: StreamOptions.optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  tools: z.array(OpenAITool).optional(),
  tool_choice: ToolChoice.optional(),
  response_format: ResponseFormat.optional(),
  logprobs: z.boolean().optional(),
  n: z.number().int().optional(),
  stop: z.unknown().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  user: z.string().optional(),
  // fm-server extensions (X-prefix to avoid colliding with future OpenAI fields).
  x_context_strategy: z.string().optional(),
  x_context_max_turns: z.number().int().optional(),
  x_context_output_reserve: z.number().int().optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequest>;

// MARK: - Chat completion response

export const Usage = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const Choice = z.object({
  index: z.number().int().nonnegative(),
  message: OpenAIMessage,
  finish_reason: z.string().nullable(),
  logprobs: z.unknown().nullable(),
});
export type Choice = z.infer<typeof Choice>;

export const ChatCompletionResponse = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(Choice),
  usage: Usage,
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponse>;

// MARK: - Models list (/v1/models)

export const ModelObject = z.object({
  id: z.string(),
  object: z.literal("model"),
  created: z.number().int(),
  owned_by: z.string(),
  context_window: z.number().int(),
  supported_parameters: z.array(z.string()),
  unsupported_parameters: z.array(z.string()),
  notes: z.string(),
});
export type ModelObject = z.infer<typeof ModelObject>;

export const ModelsListResponse = z.object({
  object: z.literal("list"),
  data: z.array(ModelObject),
});
export type ModelsListResponse = z.infer<typeof ModelsListResponse>;

// MARK: - Errors (the wire envelope)

export const OpenAIError = z.object({
  message: z.string(),
  type: z.string(),
  param: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});
export type OpenAIError = z.infer<typeof OpenAIError>;

export const OpenAIErrorResponse = z.object({
  error: OpenAIError,
});
export type OpenAIErrorResponse = z.infer<typeof OpenAIErrorResponse>;
