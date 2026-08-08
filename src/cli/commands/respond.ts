// ============================================================================
// respond.ts — `fm-server respond "..."`. Generate a response to a prompt.
// ============================================================================

import { defineCommand } from "citty";
import { respond as fmRespond } from "fm-access-pcc";
import { ModelBackend, Session } from "../../server/index.js";
import { createInference } from "../inference.js";

export const respondCommand = defineCommand({
  meta: {
    name: "respond",
    description: "Generate a response to a prompt.",
  },
  args: {
    text: {
      type: "positional",
      required: false,
      description: "The prompt text. If omitted, reads from stdin.",
    },
    model: {
      type: "string",
      description: "Model to use: 'system' (on-device, default) or 'pcc' (Private Cloud Compute).",
      default: "system",
    },
    stream: {
      type: "boolean",
      description: "Stream the response as it's generated.",
    },
    instructions: {
      type: "string",
      description: "System instructions for the session.",
    },
    temperature: {
      type: "string",
      description: "Sampling temperature (0.0-1.0).",
    },
    "max-tokens": {
      type: "string",
      description: "Maximum tokens to generate.",
    },
    seed: {
      type: "string",
      description: "Random seed for reproducible generation.",
    },
    json: {
      type: "boolean",
      description: "Emit a JSON envelope instead of plain text.",
    },
  },
  async run({ args }) {
    const promptText = args.text ? String(args.text) : await readAllStdin();
    if (!promptText.trim()) {
      process.stderr.write("fm-server: no prompt provided\n");
      process.exit(2);
    }

    const modelBackend = ModelBackend.fromModelName(String(args.model));

    // PCC: route through fm-access-pcc directly
    if (modelBackend === "privateCloudCompute") {
      await respondPcc(promptText, args);
      return;
    }

    const { inference, shutdown } = createInference();
    const session = Session.open(
      inference,
      modelBackend,
      args.instructions as string | undefined,
    );

    const sessionOptions = {
      temperature: args.temperature ? Number.parseFloat(args.temperature as string) : undefined,
      maxTokens: args["max-tokens"] ? Number.parseInt(args["max-tokens"] as string, 10) : undefined,
      seed: args.seed ? Number.parseInt(args.seed as string, 10) : undefined,
    };

    try {
      if (args.stream) {
        const stream = session.stream(promptText, sessionOptions);
        let fullContent = "";
        let finishReason = "unknown";
        let usage = undefined;

        for await (const event of stream) {
          if (event.kind === "delta" && event.text) {
            process.stdout.write(event.text);
            fullContent += event.text;
          } else if (event.kind === "done") {
            finishReason = event.finishReason;
            usage = event.usage;
          }
        }
        if (args.json) {
          process.stdout.write(
            `\n${JSON.stringify({
              model: ModelBackend.canonicalModelID(modelBackend),
              content: fullContent,
              finish_reason: finishReason,
              usage,
            })}\n`,
          );
        } else {
          process.stdout.write("\n");
        }
      } else {
        const result = await session.respond(promptText, sessionOptions);
        if (args.json) {
          process.stdout.write(
            `${JSON.stringify({
              model: ModelBackend.canonicalModelID(modelBackend),
              content: result.content,
              finish_reason: result.finishReason,
              usage: result.usage,
            })}\n`,
          );
        } else {
          process.stdout.write(`${result.content}\n`);
        }
      }
    } finally {
      await session.close();
      shutdown();
    }
  },
});

async function respondPcc(
  prompt: string,
  args: { stream?: boolean; instructions?: unknown; json?: boolean },
): Promise<void> {
  const instructions = args.instructions as string | undefined;

  if (args.stream) {
    const chunks = fmRespond(prompt, { model: "pcc", instructions, stream: true });
    let fullContent = "";
    for await (const chunk of chunks) {
      process.stdout.write(chunk.text);
      fullContent += chunk.text;
    }
    if (args.json) {
      process.stdout.write(
        `\n${JSON.stringify({ model: "pcc", content: fullContent, finish_reason: "stop" })}\n`,
      );
    } else {
      process.stdout.write("\n");
    }
  } else {
    const result = await fmRespond(prompt, { model: "pcc", instructions, stream: false });
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ model: "pcc", content: result.text, finish_reason: "stop" })}\n`,
      );
    } else {
      process.stdout.write(`${result.text}\n`);
    }
  }
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await new Promise<string>((resolveStdin) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolveStdin(Buffer.concat(chunks).toString("utf8")));
  });
}
