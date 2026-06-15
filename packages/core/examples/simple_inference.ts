/**
 * Simple Inference Example
 *
 * This example demonstrates basic usage of the Foundation Models SDK
 * for non-streaming inference with the on-device model.
 *
 * Usage:
 *   ts-node simple_inference.ts
 *   # or after building
 *   node dist/examples/simple_inference.js
 */

import * as fm from "@afm-js/core";

async function main() {
  console.log("=== Simple Inference Example ===\n");

  // Get the default system foundation model
  const model = new fm.SystemLanguageModel();

  // Check if the model is available
  const [isAvailable, reason] = await model.isAvailable();

  if (!isAvailable) {
    console.log(`Foundation Models not available: ${reason}`);
    return;
  }

  // Create a session
  const session = new fm.LanguageModelSession({
    instructions: "You are a helpful assistant.",
  });

  // Generate a response
  const prompt = "Hello, how are you?";
  console.log(`User: ${prompt}\n`);

  try {
    const response = await session.respond(prompt);
    console.log(`Assistant: ${response.content}`);
    console.log(`\n(Finish reason: ${response.finishReason})`);
    console.log(
      `Usage: ${response.usage.promptTokens} prompt tokens, ${response.usage.completionTokens} completion tokens`
    );
  } catch (err) {
    console.error("Error generating response:", err);
  }

  // Shutdown
  await session.shutdown();
  await model.shutdown();
}

main().catch(console.error);
