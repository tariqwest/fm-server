// ============================================================================
// available.ts — `fm-server available`. Check if Foundation Models are available.
// ============================================================================

import { defineCommand } from "citty";
import { ModelAvailability } from "../../server/index.js";
import { createInference } from "../inference.js";

export const availableCommand = defineCommand({
  meta: {
    name: "available",
    description: "Check if Foundation Models are available on this device.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit a JSON envelope instead of plain text.",
    },
  },
  async run({ args }) {
    const { inference, shutdown } = createInference();

    try {
      const status = inference.availability;
      const isAvailable = ModelAvailability.isAvailable(status);

      if (args.json) {
        process.stdout.write(
          `${JSON.stringify({
            available: isAvailable,
            status,
          })}\n`,
        );
      } else if (isAvailable) {
        process.stdout.write("Foundation Models are available.\n");
      } else {
        process.stdout.write(
          `Foundation Models are not available: ${ModelAvailability.shortLabel(status)}\n`,
        );
      }

      process.exit(isAvailable ? 0 : 1);
    } catch (err) {
      process.stderr.write(`fm-server: availability check failed: ${err}\n`);
      process.exit(1);
    } finally {
      shutdown();
    }
  },
});