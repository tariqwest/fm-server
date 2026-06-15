// ============================================================================
// Bridge module — Backend implementations for accessing Apple Foundation Models
//
// Both backends (afm-fm-helper and /usr/bin/fm) now speak HTTP/1.1 over a
// Unix domain socket. UnifiedBackend wraps FmSocketClient for both.
// ============================================================================

export {
  HelperProcess,
  type HelperProcessOptions,
  type HelperRequest,
  type HelperReply,
  type HelperOkAvailability,
  type HelperOkOpenSession,
  type HelperOkRespond,
  type HelperOkSimple,
  type HelperErrorEnvelope,
  type HelperStreamDelta,
  type HelperStreamDone,
  type HelperStreamFrame,
} from "./HelperProcess.js";

export {
  UnifiedBackend,
  type BackendKind,
  type UnifiedBackendOptions,
} from "./UnifiedBackend.js";

export {
  HelperProcessManager,
  type HelperProcess as HelperProcessHandle,
} from "./HelperProcessManager.js";
