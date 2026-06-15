// ============================================================================
// main.swift — afm-fm-helper entry point.
//
// Starts an HTTP/1.1 server on a Unix domain socket, exposing the same
// OpenAI-compatible surface as /usr/bin/fm:
//   GET  /health
//   GET  /v1/models
//   POST /v1/chat/completions
//
// Usage: afm-fm-helper serve --socket <path>
// ============================================================================

import Foundation
import FoundationModels

guard #available(macOS 26.0, *) else {
    FileHandle.standardError.write(Data("afm-fm-helper: requires macOS 26 or later\n".utf8))
    exit(1)
}

// ─── Argument parsing ────────────────────────────────────────────────────────

var socketPath: String?
var args = CommandLine.arguments.dropFirst()

while !args.isEmpty {
    let arg = args.removeFirst()
    switch arg {
    case "serve":
        break  // subcommand, consumed
    case "--socket":
        socketPath = args.isEmpty ? nil : args.removeFirst()
    default:
        break
    }
}

guard let path = socketPath else {
    FileHandle.standardError.write(Data(
        "usage: afm-fm-helper serve --socket <path>\n".utf8))
    exit(1)
}

// ─── Start server ────────────────────────────────────────────────────────────

let registry = SessionRegistry()
let routes = buildRoutes(registry: registry)

let server: HTTPServer
do {
    server = try HTTPServer(socketPath: path, routes: routes)
} catch {
    FileHandle.standardError.write(Data("afm-fm-helper: failed to create listener: \(error)\n".utf8))
    exit(1)
}

// Graceful shutdown on SIGTERM/SIGINT
let sigSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
sigSrc.setEventHandler { server.shutdown(); exit(0) }
sigSrc.resume()
signal(SIGTERM, SIG_IGN)

let sigInt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
sigInt.setEventHandler { server.shutdown(); exit(0) }
sigInt.resume()
signal(SIGINT, SIG_IGN)

try await server.run()
