// ============================================================================
// main.ts — Entry point for the afm-js binary. Defines the top-level CLI
// surface via citty subcommands.
// ============================================================================

import { defineCommand, runMain } from "citty";
import { benchmarkCommand } from "./commands/benchmark.js";
import { chatCommand } from "./commands/chat.js";
import { promptCommand } from "./commands/prompt.js";
import { serveCommand } from "./commands/serve.js";

const main = defineCommand({
  meta: {
    name: "afm-js",
    version: "0.0.2",
    description:
      "Apple Foundation Models for Node.js. OpenAI-compatible HTTP server + CLI for Apple Intelligence.",
  },
  subCommands: {
    serve: serveCommand,
    prompt: promptCommand,
    chat: chatCommand,
    benchmark: benchmarkCommand,
  },
});

runMain(main);
