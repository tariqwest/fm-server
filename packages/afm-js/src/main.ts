// ============================================================================
// main.ts — Entry point for the afm-js binary. Defines the top-level CLI
// surface via citty subcommands. M1 ships only `serve` and `model-info`;
// `chat`, `prompt`, `benchmark`, `autostart` come in M2/M3.
// ============================================================================

import { defineCommand, runMain } from "citty";
import { autostartCommand } from "./commands/autostart.js";
import { benchmarkCommand } from "./commands/benchmark.js";
import { chatCommand } from "./commands/chat.js";
import { promptCommand } from "./commands/prompt.js";
import { serveCommand } from "./commands/serve.js";

const main = defineCommand({
  meta: {
    name: "afm-js",
    version: "0.0.1",
    description:
      "Apple Foundation Models for Node.js. OpenAI-compatible HTTP server + CLI for Apple Intelligence.",
  },
  subCommands: {
    serve: serveCommand,
    prompt: promptCommand,
    chat: chatCommand,
    autostart: autostartCommand,
    benchmark: benchmarkCommand,
  },
});

runMain(main);
