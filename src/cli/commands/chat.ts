// ============================================================================
// chat.ts — `fm-server chat`. Multi-turn REPL via node:readline.
// ============================================================================

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { defineCommand } from "citty";
import { ModelBackend, Session } from "../../server/index.js";
import { createInference } from "../inference.js";

export const chatCommand = defineCommand({
  meta: {
    name: "chat",
    description: "Interactive multi-turn chat REPL.",
  },
  args: {
    model: {
      type: "string",
      description: "Model to use: 'system' (on-device, default). PCC is not supported.",
      default: "system",
    },
    instructions: { type: "string", description: "Optional system instructions." },
  },
  async run({ args }) {
    if (!input.isTTY) {
      process.stderr.write("fm-server chat: requires an interactive terminal (stdin must be a TTY)\n");
      process.exit(2);
    }

    if (args.model === "pcc") {
      process.stderr.write(
        "fm-server: Private Cloud Compute (model: 'pcc') is not supported. Use model: 'system'.\n",
      );
      process.exit(2);
    }

    const { inference, shutdown } = createInference();
    const modelBackend = ModelBackend.fromModelName(String(args.model));
    const session = Session.open(
      inference,
      modelBackend,
      args.instructions as string | undefined,
    );

    const rl = createInterface({ input, output });
    process.stdout.write("fm-server chat (on-device). Ctrl-D to exit.\n");

    try {
      while (true) {
        const line = await rl.question("you> ").catch(() => null);
        if (line == null) break;
        if (line.trim() === "") continue;
        process.stdout.write("assistant> ");
        try {
          for await (const event of session.stream(line)) {
            if (event.kind === "delta") {
              process.stdout.write(event.text);
            }
          }
          process.stdout.write("\n");
        } catch (err) {
          process.stdout.write("\n");
          process.stderr.write(`fm-server: error - ${err instanceof Error ? err.message : err}\n`);
        }
      }
    } finally {
      rl.close();
      await session.close();
      shutdown();
      process.stdout.write("\nGoodbye.\n");
    }
  },
});