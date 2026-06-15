/**
 * Streaming Response Example
 *
 * This example demonstrates how to stream responses from the model,
 * receiving chunks of text as they are generated.
 *
 * Usage:
 *   ts-node streaming_example.ts
 *   # or after building
 *   node dist/examples/streaming_example.js
 */

import * as fm from "@afm-js/core";

async function main() {
  console.log("=== Streaming Response Example ===\n");

  // Check if the model is available
  const model = new fm.SystemLanguageModel();
  const [isAvailable, reason] = await model.isAvailable();

  if (!isAvailable) {
    console.log(`Model not available: ${reason}`);
    return;
  }

  // Create a session
  const session = new fm.LanguageModelSession({
    instructions: "You are a helpful assistant.",
  });

  // Stream a response
  const prompt = "Tell me a short story about a cat.";
  console.log(`User: ${prompt}\n`);
  process.stdout.write("Assistant: ");

  try {
    // Iterate through response chunks as they arrive
    for await (const chunk of session.streamResponse(prompt)) {
      process.stdout.write(chunk.text);

      if (chunk.isFinal) {
        console.log("\n");
        if (chunk.usage) {
          console.log(
            `(Finish reason: ${chunk.finishReason}, ${chunk.usage.totalTokens} total tokens)`
          );
        }
      }
    }
  } catch (err) {
    console.error("\nError streaming response:", err);
  }

  // Cleanup
  await session.shutdown();
  await model.shutdown();
}

main().catch(console.error);
