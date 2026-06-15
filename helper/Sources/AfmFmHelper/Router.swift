// ============================================================================
// Router.swift — Route handlers for the helper's HTTP server.
// Exposes the same OpenAI-compatible surface as /usr/bin/fm:
//   GET  /health
//   GET  /v1/models
//   POST /v1/chat/completions  (streaming and non-streaming)
// ============================================================================

import Foundation
import FoundationModels
import Network

// ─── JSON helpers ───────────────────────────────────────────────────────────

private let decoder = JSONDecoder()

private func decodeBody<T: Decodable>(_ type: T.Type, from request: HTTPRequest) throws -> T {
    try decoder.decode(type, from: request.body)
}

// ─── Route builder ──────────────────────────────────────────────────────────

@available(macOS 26.0, *)
func buildRoutes(registry: SessionRegistry) -> [(method: String, path: String, handler: RouteHandler)] {
    [
        ("GET",  "/health",               healthHandler()),
        ("GET",  "/v1/models",            modelsHandler()),
        ("POST", "/v1/chat/completions",  chatCompletionsHandler(registry: registry)),
    ]
}

// ─── /health ────────────────────────────────────────────────────────────────

private func healthHandler() -> RouteHandler {
    { _, connection in
        let resp = HTTPResponse.jsonObject(["status": "ok", "backend": "afm-fm-helper"])
        send(resp.serialized(), on: connection, close: true)
    }
}

// ─── /v1/models ─────────────────────────────────────────────────────────────

@available(macOS 26.0, *)
private func modelsHandler() -> RouteHandler {
    { _, connection in
        var models: [[String: Any]] = [
            [
                "id": "system",
                "object": "model",
                "created": 1719792000,
                "owned_by": "apple",
            ]
        ]
        // Advertise PCC only when available
        if #available(macOS 27.0, *) {
            models.append([
                "id": "pcc",
                "object": "model",
                "created": 1749340800,
                "owned_by": "apple",
            ])
        }
        let body: [String: Any] = ["object": "list", "data": models]
        let resp = HTTPResponse.jsonObject(body)
        send(resp.serialized(), on: connection, close: true)
    }
}

// ─── /v1/chat/completions ───────────────────────────────────────────────────

// Minimal subset of the OpenAI ChatCompletion request we need to handle.
private struct ChatRequest: Decodable {
    let model: String
    let messages: [Message]
    let stream: Bool?
    let temperature: Double?
    let max_tokens: Int?
    let seed: Int?

    struct Message: Decodable {
        let role: String
        let content: String
    }
}

@available(macOS 26.0, *)
private func chatCompletionsHandler(registry: SessionRegistry) -> RouteHandler {
    { request, connection in
        guard let chatReq = try? decodeBody(ChatRequest.self, from: request) else {
            let resp = HTTPResponse.error("invalid request body", status: 400)
            send(resp.serialized(), on: connection, close: true)
            return
        }

        // Flatten messages into (instructions, finalPrompt)
        let (instructions, prompt) = flattenMessages(chatReq.messages)

        // Determine backend
        let backendKind: Backend = chatReq.model == "pcc" ? .pcc : .onDevice

        // Open session
        let session: LanguageModelSession
        do {
            session = try Backends.openSession(backend: backendKind, instructions: instructions)
        } catch {
            let resp = HTTPResponse.error(error.localizedDescription, status: 503)
            send(resp.serialized(), on: connection, close: true)
            return
        }
        let sid = registry.register(session)
        defer { registry.remove(sid) }

        let opts = makeOpts(temperature: chatReq.temperature, maxTokens: chatReq.max_tokens)
        let requestId = "chatcmpl-\(UUID().uuidString.prefix(8).lowercased())"
        let created = Int(Date().timeIntervalSince1970)
        let modelName = chatReq.model

        if chatReq.stream == true {
            // ── Streaming ────────────────────────────────────────────────
            let header = Data(sseHeaders().utf8)
            send(header, on: connection, close: false)

            // Role chunk
            let roleChunk = sseChunk(id: requestId, created: created, model: modelName, delta: ["role": "assistant"])
            send(sseEvent(roleChunk), on: connection, close: false)

            var prev = ""
            var completionTokens = 0
            do {
                for try await snapshot in session.streamResponse(to: prompt, options: opts) {
                    let content = snapshot.content
                    if content.count > prev.count, content.hasPrefix(prev) {
                        let delta = String(content.dropFirst(prev.count))
                        if !delta.isEmpty {
                            let chunk = sseChunk(id: requestId, created: created, model: modelName, delta: ["content": delta])
                            send(sseEvent(chunk), on: connection, close: false)
                            completionTokens += max(1, delta.utf8.count / 4)
                        }
                    }
                    prev = content
                }
            } catch {
                let errChunk = sseChunk(id: requestId, created: created, model: modelName, delta: [:], finishReason: "error")
                send(sseEvent(errChunk), on: connection, close: false)
                send(sseDone(), on: connection, close: true)
                return
            }

            // Finish chunk
            let finishChunk = sseChunk(id: requestId, created: created, model: modelName, delta: [:], finishReason: "stop")
            send(sseEvent(finishChunk), on: connection, close: false)

            // Usage chunk
            let promptTokens = max(1, prompt.utf8.count / 4)
            let usageChunk = sseUsageChunk(id: requestId, created: created, model: modelName,
                                           promptTokens: promptTokens, completionTokens: completionTokens)
            send(sseEvent(usageChunk), on: connection, close: false)
            send(sseDone(), on: connection, close: true)

        } else {
            // ── Non-streaming ────────────────────────────────────────────
            do {
                let response = try await session.respond(to: prompt, options: opts)
                let content = response.content
                let promptTokens = max(1, prompt.utf8.count / 4)
                let completionTokens = max(1, content.utf8.count / 4)
                let body: [String: Any] = [
                    "id": requestId,
                    "object": "chat.completion",
                    "created": created,
                    "model": modelName,
                    "choices": [[
                        "index": 0,
                        "message": ["role": "assistant", "content": content],
                        "finish_reason": "stop",
                        "logprobs": NSNull(),
                    ]],
                    "usage": [
                        "prompt_tokens": promptTokens,
                        "completion_tokens": completionTokens,
                        "total_tokens": promptTokens + completionTokens,
                    ]
                ]
                let resp = HTTPResponse.jsonObject(body)
                send(resp.serialized(), on: connection, close: true)
            } catch {
                let resp = HTTPResponse.error(error.localizedDescription, status: 503)
                send(resp.serialized(), on: connection, close: true)
            }
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Pull system message as instructions; concatenate the rest as the final user prompt.
private func flattenMessages(_ messages: [ChatRequest.Message]) -> (instructions: String?, prompt: String) {
    let system = messages.first(where: { $0.role == "system" })?.content
    let userLines = messages.filter { $0.role != "system" }.map { "\($0.role): \($0.content)" }
    return (instructions: system, prompt: userLines.joined(separator: "\n"))
}

@available(macOS 26.0, *)
private func makeOpts(temperature: Double?, maxTokens: Int?) -> GenerationOptions {
    if let t = temperature {
        return GenerationOptions(temperature: t, maximumResponseTokens: maxTokens)
    }
    return GenerationOptions(maximumResponseTokens: maxTokens)
}

private func sseChunk(
    id: String,
    created: Int,
    model: String,
    delta: [String: Any],
    finishReason: String? = nil
) -> String {
    var choice: [String: Any] = [
        "index": 0,
        "delta": delta,
        "logprobs": NSNull(),
        "finish_reason": finishReason as Any,
    ]
    if finishReason == nil { choice["finish_reason"] = NSNull() }
    let obj: [String: Any] = [
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [choice],
    ]
    return (try? String(data: JSONSerialization.data(withJSONObject: obj), encoding: .utf8)) ?? "{}"
}

private func sseUsageChunk(id: String, created: Int, model: String,
                           promptTokens: Int, completionTokens: Int) -> String {
    let obj: [String: Any] = [
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [] as [[String: Any]],
        "usage": [
            "prompt_tokens": promptTokens,
            "completion_tokens": completionTokens,
            "total_tokens": promptTokens + completionTokens,
        ]
    ]
    return (try? String(data: JSONSerialization.data(withJSONObject: obj), encoding: .utf8)) ?? "{}"
}
