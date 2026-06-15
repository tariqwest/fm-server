// ============================================================================
// Bridge module — Backend implementations for accessing Apple Foundation Models
//
// Provides two backend options:
// - HelperProcess: Direct integration via afm-fm-helper binary (stdin/stdout)
// - UnifiedBackend: Abstraction that supports both FM CLI and helper backends
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
