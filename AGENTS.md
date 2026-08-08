# AGENTS.md — fm-server

Guide for AI agents working in this repository.

## Project summary

**fm-server** is a single-package Node.js app that exposes Apple Foundation Models through:

1. An OpenAI-compatible HTTP server (Hono)
2. A CLI binary (`fm-server`)

Two inference backends:

- **`system`** (on-device) — runs in-process via [`javascript-apple-fm-sdk`](https://github.com/tariqwest/javascript-apple-fm-sdk)
- **`pcc`** (Private Cloud Compute) — wraps the macOS `fm` CLI / `fm serve` via [`fm-access-pcc`](https://github.com/tariqwest/fm-access-PCC)

- **Repo:** https://github.com/tariqwest/fm-server
- **Package name:** `fm-server` (version in `package.json`)
- **Platform:** macOS 26+, Apple Silicon only (`package.json` `os`/`cpu` fields); PCC requires macOS 27+

## Architecture

```
src/cli/          Terminal commands (citty)
    └─ imports ► src/server/index.ts (public API)

src/server/
    app.ts        Hono routes: /health, /v1/models, /v1/chat/completions
    server.ts     @hono/node-server bootstrap (startServer)
    session/      Backend-dispatching session wrapper
    sdk/          javascript-apple-fm-sdk adapter (InferenceService, ModelProvider, …)
    pcc/          fm-access-pcc adapter (PccInferenceService)
    mcp/          stdio MCP tool injection
    validators/   Request validation (model acceptance, unsupported params)
    errors/       AfmError taxonomy → OpenAI wire format
```

### Inference path

```
HTTP request
  → ChatRequestValidator.validate()
  → ContextManager.makeContext()     # fold messages → (instructions, prompt)
  → Session.open(inference, backend, instructions)
       ├─ onDevice:
       │    → InferenceService.respond() | .stream()
       │    → javascript-apple-fm-sdk LanguageModelSession
       └─ privateCloudCompute:
            → PccInferenceService.respond() | .stream()
            → fm-access-pcc → fm serve / /usr/bin/fm CLI
  → Session.close()
```

### Session strategy

- **HTTP:** one session per `/v1/chat/completions` request (both backends)
- **CLI `chat`:** on-device reuses a single `LanguageModelSession` across REPL turns; PCC uses `fm-access-pcc`'s `createChatSession()`
- Multi-turn HTTP history is folded into text by `ContextManager` (Transcript API not yet wired)

### Streaming

- **On-device:** `javascript-apple-fm-sdk` `streamResponse()` yields cumulative snapshots. `InferenceService.stream()` converts to deltas via `snapshot.slice(prev.length)` before emitting SSE chunks.
- **PCC:** `fm-access-pcc`'s `respond()` with `stream: true` yields incremental text chunks directly.

## Directory map

| Path | Purpose |
|------|---------|
| `src/server/app.ts` | Hono app factory, chat completion handler |
| `src/server/server.ts` | `startServer()`, MCP client wiring, shutdown |
| `src/server/index.ts` | Public exports (also `package.json` main) |
| `src/server/version.ts` | Package version (single source of truth from `package.json`) |
| `src/server/sdk/` | On-device SDK adapter layer (javascript-apple-fm-sdk) |
| `src/server/pcc/PccInferenceService.ts` | PCC adapter (fm-access-pcc) |
| `src/server/session/Session.ts` | Backend-dispatching session wrapper |
| `src/server/session/ContextManager.ts` | Message folding → instructions + prompt |
| `src/server/validators/ChatRequestValidator.ts` | Model/param validation |
| `src/server/errors/AfmError.ts` | Error taxonomy + HTTP status mapping |
| `src/cli/main.ts` | CLI entry (citty subcommands) |
| `src/cli/commands/` | Individual CLI commands |
| `src/cli/inference.ts` | `createInference()` helper for CLI |
| `src/entry.ts` | Bun/tsx CLI entry (no compile) |
| `bin/fm-server.js` | Bin shim → `dist/cli/main.js` |
| `test/unit/` | Vitest unit tests |
| `test/e2e/` | Live CLI/server tests (require native SDK) |
| `scripts/release.js` | Release + Homebrew formula pipeline |

## Public API

Exported from `src/server/index.ts`, published as `fm-server`:

```typescript
import {
  startServer,
  createApp,
  InferenceService,
  ModelProvider,
  toGenerationOptions,
  SdkErrorMapper,
  Session,
  AfmError,
  ModelBackend,
  ModelAvailability,
  McpStdioClient,
  makeContext,
  VERSION,
} from "fm-server";
```

CLI commands import from `../../server/index.js` (relative), not from the package name.

## Pinned sibling dependencies

| Package | Spec |
|---------|------|
| `javascript-apple-fm-sdk` | `https://github.com/tariqwest/javascript-apple-fm-sdk/releases/download/v0.1.0/javascript-apple-fm-sdk-0.1.0.tgz` |
| `fm-access-pcc` | `https://github.com/tariqwest/fm-access-PCC/releases/download/v0.2.0/fm-access-pcc-0.2.0.tgz` |

Release packaging vendors from `node_modules` (or optional path overrides).

## Commands

```bash
pnpm install          # installs pinned GH release tarballs (sdk v0.1.0, fm-access-pcc v0.2.0)
pnpm run build        # tsc → dist/
bun test              # bun:test (unit + e2e)
bun run test:e2e      # e2e only
pnpm run typecheck
bun run ci            # typecheck + bun test
pnpm run release      # GitHub release + Homebrew tap (needs GITHUB_TOKEN)
```

E2E tests call `isNativeAvailable()` from `javascript-apple-fm-sdk` and skip when bindings are missing.

## Conventions

- **ESM only** — all imports use `.js` extensions (`"module": "NodeNext"`)
- **TypeScript** — strict mode, `src/` → `dist/` mirroring
- **Lint/format** — Biome (`pnpm run check`)
- **Errors** — SDK errors flow through `SdkErrorMapper` → `AfmError` → OpenAI JSON envelope
- **Model IDs** — `system` (on-device) and `pcc` (Private Cloud Compute) accepted; others rejected with 400
- **Logging prefix** — CLI messages use `fm-server:` on stderr

## SDK error → HTTP status

| SDK error | HTTP |
|-----------|------|
| `GuardrailViolationError` | 400 |
| `ExceededContextWindowSizeError` | 400 |
| `RateLimitedError` / `ConcurrentRequestsError` | 429 |
| `AssetsUnavailableError` | 503 |

## What NOT to do

- Do not reintroduce subprocess backends for on-device inference (`bridge/`, `afm-fm-helper`)
- Do not split back into a pnpm workspace monorepo without explicit direction
- Do not add `--helper` / `AFM_HELPER_PATH` flags

## Making changes

| Task | Where to edit |
|------|---------------|
| New HTTP route | `src/server/app.ts` |
| OpenAI request schema | `src/server/openai/index.ts` |
| Validation rules | `src/server/validators/ChatRequestValidator.ts` |
| On-device inference | `src/server/sdk/InferenceService.ts` |
| PCC inference | `src/server/pcc/PccInferenceService.ts` |
| SDK error mapping | `src/server/sdk/SdkErrorMapper.ts` |
| New CLI command | `src/cli/commands/` + register in `src/cli/main.ts` |
| MCP tool injection | `src/server/mcp/McpClient.ts`, `src/server/app.ts` |

After edits: `pnpm run build && pnpm test && pnpm run typecheck`.

## Release

See `RELEASING.md`. Release artifacts:

- `fm-server-prebuilt-arm64-apple-darwin-{version}.tar.gz`
- Homebrew formula `fm-server.rb` in `tariqwest/homebrew-tap`

Env vars: `GITHUB_TOKEN`, `RELEASE_DRY_RUN`, `TAP_DIR` (default `~/.cache/fm-server-tap`).

## Related docs

- `.agents/sdk-migration-plan.md` — historical migration notes (subprocess → in-process SDK)
- `RELEASING.md` — release workflow
