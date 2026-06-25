// ============================================================================
// token-count.ts — `fm-server token-count "..."`. Count tokens without generating.
// ============================================================================

import { defineCommand } from "citty";
import { createInference } from "../inference.js";

export const tokenCountCommand = defineCommand({
  meta: {
    name: "token-count",
    description: "Count tokens in a prompt or instructions without generating.",
  },
  args: {
    text: {
      type: "positional",
      required: false,
      description: "The text to count. If omitted, reads from stdin.",
    },
    instructions: {
      type: "string",
      description: "Instructions to include in token count.",
    },
    json: {
      type: "boolean",
      description: "Emit a JSON envelope instead of plain text.",
    },
  },
  async run({ args }) {
    const text = args.text ? String(args.text) : await readAllStdin();
    if (!text.trim() && !args.instructions) {
      process.stderr.write("fm-server: no text or instructions provided\n");
      process.exit(2);
    }

    const { inference, shutdown } = createInference();

    try {
      const promptTokens = args.instructions
        ? await inference.tokenCountForPrompt(text.trim() || ".", String(args.instructions))
        : await inference.tokenCountForPrompt(text.trim() || ".");

      if (args.json) {
        process.stdout.write(
          `${JSON.stringify({
            prompt_tokens: promptTokens,
            total_tokens: promptTokens,
          })}\n`,
        );
      } else {
        process.stdout.write(`${promptTokens}\n`);
      }
    } catch (err) {
      process.stderr.write(`fm-server: token count failed: ${err}\n`);
      process.exit(1);
    } finally {
      shutdown();
    }
  },
});

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await new Promise<string>((resolveStdin) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolveStdin(Buffer.concat(chunks).toString("utf8")));
  });
}