// fm-server public surface.
export { createApp, type AppConfig } from "./app.js";
export {
  startServer,
  type StartOptions,
  type RunningServer,
  type McpServerSpec,
} from "./server.js";
export { InferenceService } from "./sdk/InferenceService.js";
export { ModelProvider } from "./sdk/ModelProvider.js";
export { toGenerationOptions, type OpenAIGenerationParams } from "./sdk/GenerationMapper.js";
export { SdkErrorMapper } from "./sdk/SdkErrorMapper.js";
export { ModelBackend } from "./backend/ModelBackend.js";
export { ModelAvailability } from "./backend/ModelAvailability.js";
export { AfmError } from "./errors/AfmError.js";
export { Session, type SessionOptions, type SessionRespondResult } from "./session/Session.js";
export { McpStdioClient } from "./mcp/McpClient.js";
export {
  makeContext,
  type MakeSessionInput,
  type PreparedSession,
} from "./session/ContextManager.js";
export { VERSION } from "./version.js";
