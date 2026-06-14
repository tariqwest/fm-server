# afm-js

Apple Foundation Models for Node.js. OpenAI-compatible HTTP server and CLI for Apple Intelligence on macOS.

A TypeScript / Node.js port of [apfel-plus](https://github.com/tariqwest/apfel-plus) (Swift). Same OpenAI wire format, same `/v1/chat/completions`, `/v1/models`, `/health`, same `--pcc` opt-in to Apple Private Cloud Compute. Reaches the on-device `SystemLanguageModel` (and, on macOS 27+, `PrivateCloudComputeLanguageModel`) via a small Swift helper binary spoken to over newline-JSON.

> **Status:** M3 — feature complete for the OpenAI surface. On top of M2 (streaming, multi-turn, tool calling, MCP stdio), M3 adds structured outputs (`response_format: json_object` and `json_schema`), the `autostart` LaunchAgent installer (with `KeepAlive` auto-restart), and the `benchmark` command. The remaining M3 item — a signed/notarized prebuilt helper binary and `npm publish` — is a packaging step that needs an Apple Developer ID; everything else runs from `pnpm install && (cd helper && swift build -c release)`.

## Architecture

```
┌─────────────────────────────────────────┐
│  afm-js (Node 20+, TypeScript)          │
│  ┌────────────────────────────────────┐ │
│  │  @afm-js/server (Hono + Node)      │ │
│  │  /v1/chat/completions  /v1/models  │ │
│  │  /health                /v1/logs   │ │
│  └─────────────┬──────────────────────┘ │
│                │ newline-JSON over      │
│                │ stdin/stdout           │
│                ▼                        │
│  ┌────────────────────────────────────┐ │
│  │  HelperProcess                     │ │
│  │  spawns afm-fm-helper, multiplexes │ │
│  │  sessions, frames lines            │ │
│  └────────────────────────────────────┘ │
└─────────────────┼──────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  afm-fm-helper (Swift, macOS 26+)       │
│  imports FoundationModels               │
│    SystemLanguageModel                  │
│    PrivateCloudComputeLanguageModel     │
│    LanguageModelSession                 │
└─────────────────────────────────────────┘
```

**Why a Swift helper instead of FFI:** the only path that gives day-one PCC support. The helper imports `FoundationModels` directly and ships as a prebuilt arm64 binary; Node spawns it and multiplexes requests over a tiny JSON protocol. Process isolation also keeps Swift 6's strict concurrency out of Node's event loop.

## Layout

```
afm-js/
├── packages/
│   ├── core/        @afm-js/core     pure: Zod schemas, AfmError, validators, ModelBackend
│   ├── cli/         @afm-js/cli      argv -> typed config (TODO M2)
│   ├── server/      @afm-js/server   Hono + HelperProcess bridge
│   └── afm-js/      afm-js           umbrella, the npm bin
└── helper/                            Swift sources for afm-fm-helper
```

## Build (dev)

```bash
# 1. Build the helper binary.
cd helper && swift build -c release

# 2. Install Node deps + typecheck.
cd .. && pnpm install && pnpm typecheck

# 3. Run the test suite.
pnpm test
```

## Run the server

```bash
node packages/afm-js/bin/afm-js.js serve --port 11434 --token sk-test --debug
```

```bash
curl -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Authorization: Bearer sk-test" \
  -H "Content-Type: application/json" \
  -d '{"model":"apple-foundationmodel","messages":[{"role":"user","content":"Say hi."}]}'
```

Streaming:

```bash
curl -N -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Authorization: Bearer sk-test" -H "Content-Type: application/json" \
  -d '{"model":"apple-foundationmodel","stream":true,"messages":[{"role":"user","content":"Count to 5."}]}'
```

With a local MCP server (`--mcp` supports a colon-separated list of `<cmd> <arg…>` specs):

```bash
node packages/afm-js/bin/afm-js.js serve --port 11434 --mcp "python3 /path/to/mcp/server.py"
```

## CLI commands

```bash
afm-js serve [--port N --host H --token T --mcp "<cmd ...>" --debug]
afm-js prompt "Your prompt here"        # one-shot, prints answer
afm-js prompt --json "..."               # one-shot, JSON envelope
echo "What is 2+2?" | afm-js prompt      # reads from stdin
afm-js chat                              # multi-turn REPL with streaming
afm-js chat --system "Be brief."         # …with a system prompt
afm-js prompt --pcc "..."                # route to Private Cloud Compute
afm-js benchmark                          # ttft + tokens/s over 3 fixed prompts
afm-js benchmark --json                   # machine-readable report
afm-js autostart --port 11434 --token sk-X # install per-user LaunchAgent
```

## Structured outputs

```bash
curl -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Authorization: Bearer sk-test" -H "Content-Type: application/json" \
  -d '{
    "model": "apple-foundationmodel",
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "person",
        "schema": {
          "type": "object",
          "properties": {"name":{"type":"string"},"age":{"type":"integer"}},
          "required": ["name","age"]
        }
      }
    },
    "messages": [{"role":"user","content":"Give me a person named Alice who is 30."}]
  }'
# => {"name":"Alice","age":30}
```

M3 implements this via prompt-engineered schema injection plus
`JSONFenceStripper` post-processing. A future M4 will switch to the
helper's native `GenerationSchema`-guided generation for hard guarantees.

## Autostart (LaunchAgent)

```bash
afm-js autostart --port 11434 --token sk-mine
# wrote ~/Library/LaunchAgents/com.afm-js.serve.plist
# bootstrap ok — gui/501/com.afm-js.serve
```

Logs land at `~/Library/Logs/afm-js.{out,err}.log`. Manage with:

```bash
launchctl print     gui/$(id -u)/com.afm-js.serve
launchctl kickstart -k gui/$(id -u)/com.afm-js.serve   # restart
launchctl bootout   gui/$(id -u)/com.afm-js.serve     # stop & remove
```

A LaunchAgent (not Daemon) because Apple Intelligence is only reachable
from the logged-in user's GUI session.

## Models

- `apple-foundationmodel` — on-device, 4096-token context, default.
- `apple-foundationmodel-pcc` (or aliases `pcc`, `apfel-pcc`) — Apple Private Cloud Compute, 32K context, requires macOS 27+. Returns a typed 503 with a clear remediation message on ineligible hosts.

## Requirements

- macOS 26 (Tahoe) or later, Apple Silicon (M1+).
- Apple Intelligence enabled in System Settings.
- Node 20+.

## Provenance

The Swift app this ports is at [tariqwest/apfel-plus](https://github.com/tariqwest/apfel-plus); it in turn forks Franz's [Arthur-Ficial/apfel](https://github.com/Arthur-Ficial/apfel). Two libraries informed the design without being depended on:

- [codybrom/tsfm](https://github.com/codybrom/tsfm) — koffi-FFI bindings for on-device FoundationModels; no PCC.
- [apple/python-apple-fm-sdk](https://github.com/apple/python-apple-fm-sdk) — Apple's official Python SDK; clean session/model split.

## License

MIT.
