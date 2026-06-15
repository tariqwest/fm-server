// ============================================================================
// Protocol.swift — Shared types used by Backends.swift and Router.swift.
// The old newline-JSON stdin/stdout wire protocol has been replaced by
// HTTP/1.1 over a Unix domain socket (see HTTPServer.swift, Router.swift).
// ============================================================================

import Foundation

enum Backend: String, Codable {
    case onDevice = "on_device"
    case pcc
}
