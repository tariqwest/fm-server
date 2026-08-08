# P2 product overlap with afm — assessment in fm-server

**Date:** 2026-08-08  
**Source:** P2 from `javascript-apple-fm-sdk/.agents/plans/upstream-integration-analysis-2026-08.md`, evaluated in **fm-server**.

## Problem

P2 in the upstream SDK plan is product overlap with `afm` without forking Swift (interop docs, optional OpenAI serve, schema/tool dry-run, point UI at afm, monitor adapters/PCC). Assess what that means for fm-server and what remains to do here vs in the SDK.

## Current state

fm-server already is the JS-native OpenAI-compatible surface over Apple Foundation Models:

- `system` via javascript-apple-fm-sdk (in-process)
- `pcc` via fm-access-pcc (`fm` CLI / `fm serve`)
- Hono `/v1/*`, streaming, auth, MCP tool injection, Homebrew, CLI (`serve`, `respond`, `chat`, `schema` generate, etc.)

## P2 checklist vs fm-server

### 8 — Interop doc: in-process SDK vs afm serve

**Status:** Addressed in README (2026-08-08)

Added **When to use what** covering SDK, fm-server, fm-access-pcc, and afm (`afm serve` / `afm serve --ui`).

### 9 — Optional OpenAI-compatible mini-server / thin package

**Status:** Done (exceeded)

This package *is* that product (`startServer` / `createApp`, Homebrew). Not a future SDK example.

**Implication for upstream SDK plan:** item 9 should **document/depend on fm-server**, not implement a second serve layer inside the SDK repo.

### 10 — Schema/tool dry-run validate (afm tool validate / schema run)

**Status:** Partial / deferred

- Runtime: tools + `response_format` (`json_object` / `json_schema`); request validation on chat completions
- CLI: `fm-server schema` generates schemas; **no** dry-run `tool validate` / `schema validate` without inference
- Explicitly deferred for now (CLI piece not pursued in the follow-up that shipped the README section)

### 11 — Point UI users at afm serve --ui; do not rebuild workbench

**Status:** Addressed in README

No workbench in-tree (correct). README points advanced UI users at afm.

### 12 — Monitor adapters/PCC; only via C FFI when available

**Status:** Partially superseded / correct split

- On-device adapters: still wait on `foundation-models-c` (SDK concern)
- **PCC already productized** in fm-server via fm-access-pcc — not N-API, intentional package split
- Do not block fm-server PCC on C FFI; do not reimplement afm bridge / Foundation Lab signing in Node

## Recommended positioning (stack)

| Need | Use |
|------|-----|
| In-process Node/TS sessions, tools, guided gen | javascript-apple-fm-sdk / javascript-apple-fm-sdk |
| OpenAI HTTP, Homebrew, MCP, system + pcc | **fm-server** |
| PCC-only lib / Terminal-hosted fm serve | **fm-access-pcc** |
| Swift CLI, adapters, browser workbench | **afm** |

## Adjacent gaps (not P2, nearby)

- Image content rejected server-side while SDK plan has multimodal attachments — product lag if parity desired
- Dep path still `../javascript-apple-fm-sdk` vs analysis under `javascript-apple-fm-sdk` — naming/path hygiene
- Zod remains v3 here; Zod 4 is P3 on the SDK plan

## Explicit non-goals (fm-server)

- Workbench UI
- Reimplementing afm bridge / Foundation Lab signing
- Second OpenAI server inside the SDK repo
- Waiting on C FFI before shipping PCC via fm-access-pcc

## Bottom line

In **fm-server**, P2 is largely **already shipped as the product** (item 9). Remaining value was **positioning docs** (8, 11) — done in README. Optional schema/tool dry-run CLI (10) remains backlog if desired later. For **javascript-apple-fm-sdk**, rewrite P2 item 9 to point at fm-server.

## Follow-ups (optional backlog)

1. Optional: `schema validate` / `tool validate` CLI dry-run without inference
2. Upstream SDK plan edit: canonical OpenAI serve = fm-server
3. Image content / multimodal parity decision vs SDK
4. Package path/name alignment with javascript-apple-fm-sdk when ready
