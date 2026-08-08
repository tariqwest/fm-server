// ============================================================================
// chat.ts — `fm-server chat`. Multi-turn REPL via node:readline.
// ============================================================================

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { defineCommand } from "citty";
import { createChatSession } from "fm-access-pcc";
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
      description: "Model to use: 'system' (on-device, default) or 'pcc' (Private Cloud Compute).",
      default: "system",
    },
    instructions: { type: "string", description: "Optional system instructions." },
  },
  async run({ args }) {
    if (!input.isTTY) {
      process.stderr.write("fm-server chat: requires an interactive terminal (stdin must be a TTY)\n");
      process.exit(2);
    }

    const modelBackend = ModelBackend.fromModelName(String(args.model));

    // PCC: use fm-access-pcc's chat session
    if (modelBackend === "privateCloudCompute") {
      await chatPcc(args.instructions as string | undefined);
      return;
    }

    const { inference, shutdown } = createInference();
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

async function chatPcc(instructions?: string): Promise<void> {
  const rl = createInterface({ input, output });
  process.stdout.write("fm-server chat (pcc). Ctrl-D to exit.\n");

  const chat = await createChatSession({ model: "pcc", instructions });

  try {
    while (true) {
      const line = await rl.question("you> ").catch(() => null);
      if (line == null) break;
      if (line.trim() === "") continue;
      process.stdout.write("assistant> ");
      try {
        const reply = await chat.send(line);
        process.stdout.write(`${reply}\n`);
      } catch (err) {
        process.stdout.write("\n");
        process.stderr.write(`fm-server: error - ${err instanceof Error ? err.message : err}\n`);
      }
    }
  } finally {
    rl.close();
    await chat.close();
    process.stdout.write("\nGoodbye.\n");
  }
}
