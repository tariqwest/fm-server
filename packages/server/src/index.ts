// @afm-js/server public surface.
export { createApp, type AppConfig } from "./app.js";
export {
  startServer,
  type StartOptions,
  type RunningServer,
  type McpServerSpec,
} from "./server.js";
export { HelperProcess, type HelperRequest, type HelperReply } from "@afm-js/core";
export { selectBackend, type BackendSelectorOptions, checkBackendAvailability } from "./bridge/BackendSelector.js";
export { UnifiedBackend, type UnifiedBackendOptions, type BackendKind } from "@afm-js/core";
export { Session, type SessionOptions, type SessionRespondResult } from "./session/Session.js";
export { McpStdioClient } from "./mcp/McpClient.js";
export { makeContext, type MakeSessionInput, type PreparedSession } from "./session/ContextManager.js";
