# afm-js

Apple Foundation Models for Node.js. OpenAI-compatible HTTP server and CLI for Apple Intelligence on macOS. Reaches the on-device `SystemLanguageModel` (and, on macOS 27+, `PrivateCloudComputeLanguageModel`) via Apple's FM client if available, and a small Swift helper binary if not.

Provides both a CLI matching Apple's `/usr/bin/fm` semantics and a standalone SDK (`@afm-js/core`) for programmatic use.

LaunchAgent auto-start via Homebrew services. Install via Homebrew for prebuilt binaries, or build from source.

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

## Installation

### Homebrew (Recommended)

```bash
# Add the tap
brew tap tariqwest/tap

# Install afm-js
brew install afm-js

# Start the server
afm-js serve --port 11434
```

### From Source

```bash
# Clone the repository
git clone https://github.com/tariqwest/afm-js.git
cd afm-js

# Install dependencies and build
pnpm install
(cd helper && swift build -c release)
pnpm run build

# Run directly from source
node packages/afm-js/dist/main.js serve --port 11434
```

## Layout

```
afm-js/
├── packages/
│   ├── core/        @afm-js/core     SDK modeled after Apple's Python SDK
│   │   ├── src/sdk/                 LanguageModel, LanguageModelSession, AfmClient
│   │   ├── src/bridge/              HelperProcess, UnifiedBackend
│   │   └── examples/                SDK usage examples
│   ├── cli/         @afm-js/cli      argv -> typed config
│   ├── server/      @afm-js/server   Hono HTTP server + Session management
│   └── afm-js/      afm-js           CLI entry point, aggregates all packages
└── helper/                           Swift helper binary (afm-fm-helper)
    └── Sources/
        └── afm-fm-helper/           Swift FoundationModels bridge
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

**Homebrew installation:**
```bash
afm-js serve --port 11434 --token sk-test --debug
```

**From source:**
```bash
node packages/afm-js/bin/afm-js.js serve --port 11434 --token sk-test --debug
```

```bash
curl -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Authorization: Bearer sk-test" \
  -H "Content-Type: application/json" \
  -d '{"model":"system","messages":[{"role":"user","content":"Say hi."}]}'
```

Streaming:

```bash
curl -N -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Authorization: Bearer sk-test" -H "Content-Type: application/json" \
  -d '{"model":"system","stream":true,"messages":[{"role":"user","content":"Count to 5."}]}'
```

With a local MCP server (`--mcp` supports a colon-separated list of `<cmd> <arg…>` specs):

**Homebrew:**
```bash
afm-js serve --port 11434 --mcp "python3 /path/to/mcp/server.py"
```

**From source:**
```bash
node packages/afm-js/bin/afm-js.js serve --port 11434 --mcp "python3 /path/to/mcp/server.py"
```

## CLI Commands

The afm-js CLI mirrors Apple's `/usr/bin/fm` interface:

```bash
# Generate a response (one-shot)
afm-js respond "Your prompt here"
afm-js respond --model pcc "Use Private Cloud Compute"
afm-js respond --stream "Stream the response as it's generated"
afm-js respond --json "Emit JSON envelope"
echo "What is 2+2?" | afm-js respond     # reads from stdin

# Interactive chat REPL
afm-js chat                              # start interactive session
afm-js chat --instructions "Be brief."  # with system instructions
afm-js chat --model pcc                 # use PCC

# Utility commands
afm-js token-count "Hello world"        # count tokens without generating
afm-js available                        # check if FM is available
afm-js quota-usage                    # check PCC quota
afm-js schema object --name Person --string name --int age  # generate JSON schema

# HTTP server
afm-js serve [--port N --host H --token T --mcp "<cmd ...>" --debug]
```

### CLI Examples

```bash
# Simple response
afm-js respond "What is Swift?"

# Streaming with PCC
afm-js respond --model pcc --stream "Summarize this article"

# Chat with instructions
afm-js chat --instructions "You are a coding assistant"

# Check availability
afm-js available

# Token count for budgeting
afm-js token-count "This is a test prompt" --instructions "You are helpful"
```

## Structured outputs

```bash
curl -X POST http://127.0.0.1:11434/v1/chat/completions \
  -H "Authorization: Bearer sk-test" -H "Content-Type: application/json" \
  -d '{
    "model": "system",
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

## Homebrew Services (LaunchAgent)

When installed via Homebrew, afm-js can run as a background service that auto-starts at login:

```bash
# Start the service (starts now and at login)
brew services start afm-js

# Check service status
brew services info afm-js

# Restart the service
brew services restart afm-js

# Stop the service
brew services stop afm-js
```

The service runs on port 11434 by default. Logs are stored at:
- `/opt/homebrew/var/log/afm-js.log` (stdout)
- `/opt/homebrew/var/log/afm-js-error.log` (stderr)

A LaunchAgent (not Daemon) because Apple Intelligence is only reachable
from the logged-in user's GUI session.

## SDK Usage (@afm-js/core)

Use the SDK directly in your Node.js applications for programmatic access to Apple Foundation Models.

### Simple Inference

```typescript
import * as fm from "@afm-js/core";

async function main() {
  // Get the default system foundation model
  const model = new fm.SystemLanguageModel();

  // Check if the model is available
  const [isAvailable, reason] = await model.isAvailable();
  if (!isAvailable) {
    console.log(`Foundation Models not available: ${reason}`);
    return;
  }

  // Create a session with instructions
  const session = new fm.LanguageModelSession({
    instructions: "You are a helpful assistant.",
  });

  // Generate a response
  const response = await session.respond("Hello, how are you?");
  console.log(`Assistant: ${response.content}`);
  console.log(`Usage: ${response.usage.promptTokens} prompt, ${response.usage.completionTokens} completion tokens`);

  // Cleanup
  await session.shutdown();
  await model.shutdown();
}
```

### Streaming Responses

```typescript
import * as fm from "@afm-js/core";

async function main() {
  const model = new fm.SystemLanguageModel();
  const [isAvailable] = await model.isAvailable();
  if (!isAvailable) return;

  const session = new fm.LanguageModelSession({
    instructions: "You are a helpful assistant.",
  });

  // Stream a response
  const prompt = "Tell me a short story about a cat.";
  process.stdout.write("Assistant: ");

  for await (const chunk of session.streamResponse(prompt)) {
    process.stdout.write(chunk.text);

    if (chunk.isFinal && chunk.usage) {
      console.log(`\n(Finish reason: ${chunk.finishReason}, ${chunk.usage.totalTokens} total tokens)`);
    }
  }

  await session.shutdown();
  await model.shutdown();
}
```

### SDK Examples

See `packages/core/examples/` for complete working examples:
- `simple_inference.ts` — Basic non-streaming inference
- `streaming_example.ts` — Streaming response handling
- `transcript_processing.ts` — Processing transcripts from Swift apps

Run examples:
```bash
cd packages/core
npx ts-node examples/simple_inference.ts
```

## Models

- `system` — on-device, 4096-token context, default.
- `pcc` — Apple Private Cloud Compute, 32K context, requires macOS 27+. Returns a typed 503 with a clear remediation message on ineligible hosts.

## Requirements

- macOS 26 (Tahoe) or later, Apple Silicon (M1+).
- Apple Intelligence enabled in System Settings.
- Node 20+.

## Provenance

This ptoject was inspired by (but doesn't share code with) the following: 

- [Arthur-Ficial/apfel](https://github.com/Arthur-Ficial/apfel) - a UNIX-style FoundationModels tool and server in Swift which I'd forked to [tariqwest/apfel-plus](https://github.com/tariqwest/apfel-plus) to add PCC.
- [codybrom/tsfm](https://github.com/codybrom/tsfm) — koffi-FFI bindings for on-device FoundationModels; no PCC.
- [apple/python-apple-fm-sdk](https://github.com/apple/python-apple-fm-sdk) — Apple's official Python SDK; clean session/model split.

## License

MIT.
