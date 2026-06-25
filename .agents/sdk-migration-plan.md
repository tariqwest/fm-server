# SDK Migration Plan: apple-fm-sdk as Sole Backend

## Goal

Remove subprocess backends (`/usr/bin/fm`, `afm-fm-helper`) and integrate `apple-fm-sdk` in-process inside `src/server/`. Keep the OpenAI-compatible HTTP surface unchanged.

**Status: completed.** The project is now a single package (`fm-server`) with `src/server/` and `src/cli/`.

## Scope Decisions

1. **Drop PCC** until `apple-fm-sdk` adds `PrivateCloudComputeLanguageModel`. Reject `model: "pcc"` with 400.
2. **Drop subprocess/session fakery** — use real `LanguageModelSession` objects.
3. **Keep HTTP/MCP layer** — validators, MCP injection, tool resolution stay.

## Architecture

```
fm-server CLI → Hono server → InferenceService → apple-fm-sdk (in-process FFI)
```

## New Modules (`src/server/sdk/`)

| Module | Responsibility |
|--------|----------------|
| `ModelProvider.ts` | `SystemLanguageModel`, availability, context size, token counting |
| `GenerationMapper.ts` | OpenAI params → `GenerationOptions` |
| `SdkErrorMapper.ts` | SDK errors → `AfmError` |
| `InferenceService.ts` | Session lifecycle, respond, stream, shutdown |

## PR Stack (completed)

1. Add `apple-fm-sdk` runtime dep + SDK adapter layer
2. Rewrite `Session.ts`, `app.ts`, `server.ts`
3. Rewrite CLI commands; delete `backend.ts`
4. Delete `bridge/`, `fm/`, `helper/`
5. Update tests, docs, release pipeline
6. Consolidate monorepo → single package (`src/server/`, `src/cli/`)

## Breaking Changes

- No `model: "pcc"`
- No `--helper` / `AFM_HELPER_PATH`
- No `/usr/bin/fm` or `afm-fm-helper` binary
- `quota-usage` removed (fm-only endpoint)

## Session Strategy

Per-request session: create `LanguageModelSession` with instructions from `ContextManager`, respond, `release()` in `finally`. Multi-turn via existing text folding (Transcript upgrade deferred).

## Streaming

`streamResponse` yields cumulative snapshots; adapter converts to deltas via `snapshot.slice(prev.length)`.

## Error Mapping

| SDK error | HTTP |
|-----------|------|
| `GuardrailViolationError` | 400 |
| `ExceededContextWindowSizeError` | 400 |
| `RateLimitedError` / `ConcurrentRequestsError` | 429 |
| `AssetsUnavailableError` | 503 |