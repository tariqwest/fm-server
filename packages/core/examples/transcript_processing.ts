/**
 * Transcript Processing Example
 *
 * This example demonstrates how to process transcripts exported from Swift apps
 * using the Foundation Models SDK. This is a key evaluation workflow
 * for analyzing session data from your Swift application.
 *
 * The example shows:
 * - Loading transcripts exported from Swift
 * - Analyzing session structure and content
 * - Extracting metrics and statistics
 * - Comparing multiple transcripts
 *
 * Usage:
 *   ts-node transcript_processing.ts
 *   # or after building
 *   node dist/examples/transcript_processing.js
 */

import * as fm from "@afm-js/core";
import * as path from "node:path";

function main() {
  console.log("Example: Processing Transcripts from Swift Apps\n");
  console.log("This demonstrates how to analyze session data exported from");
  console.log("your Swift app using the Foundation Models Framework.\n");

  // Create a sample transcript for demonstration
  // In real usage, this would be exported from a Swift app
  const sampleTranscript: fm.Transcript = {
    version: 1,
    type: "FoundationModels.Transcript",
    transcript: {
      entries: [
        {
          id: "entry-1",
          role: "instructions",
          contents: [{ type: "text", text: "You are a helpful assistant." }],
        },
        {
          id: "entry-2",
          role: "user",
          contents: [{ type: "text", text: "What is machine learning?" }],
        },
        {
          id: "entry-3",
          role: "response",
          contents: [
            {
              type: "text",
              text: "Machine learning is a subset of artificial intelligence that enables computers to learn and improve from experience without being explicitly programmed.",
            },
          ],
        },
        {
          id: "entry-4",
          role: "user",
          contents: [{ type: "text", text: "Can you give me an example?" }],
        },
        {
          id: "entry-5",
          role: "response",
          contents: [
            {
              type: "text",
              text: "Sure! A common example is email spam filtering. The system learns to identify spam by analyzing thousands of emails and their classifications.",
            },
          ],
        },
      ],
    },
  };

  // Load and analyze transcript (simulated with sample data)
  console.log("Loading transcript...");
  const transcript = sampleTranscript;

  console.log("Analyzing transcript...");
  const analysis = fm.analyzeTranscript(transcript);

  // Print summary
  fm.printTranscriptSummary(transcript, analysis);

  // Print entries
  fm.printTranscriptEntries(transcript, 3);

  // Example: Compare multiple transcripts
  console.log("\n" + "=".repeat(60));
  console.log("COMPARING MULTIPLE TRANSCRIPTS");
  console.log("=".repeat(60));

  // Create a few more example transcripts by varying entry count
  const transcripts = [transcript];
  for (let i = 2; i <= 3; i++) {
    const t: fm.Transcript = {
      ...transcript,
      transcript: {
        entries: transcript.transcript.entries.slice(0, i + 1),
      },
    };
    transcripts.push(t);
  }

  const comparison = fm.compareTranscripts(transcripts);

  console.log(`\nCompared ${comparison.count} transcripts:`);
  console.log(`  Avg entries per session: ${comparison.avgEntries.toFixed(1)}`);
  console.log(`  Avg user entries: ${comparison.avgUserEntries.toFixed(1)}`);
  console.log(`  Avg response entries: ${comparison.avgResponseEntries.toFixed(1)}`);
  console.log(`  Avg user chars: ${comparison.avgUserChars.toFixed(1)}`);
  console.log(`  Avg response chars: ${comparison.avgResponseChars.toFixed(1)}`);
  console.log(`  Tool usage rate: ${(comparison.toolUsageRate * 100).toFixed(0)}%`);
  console.log(`  Structured output rate: ${(comparison.structuredOutputRate * 100).toFixed(0)}%`);

  console.log("\n" + "=".repeat(60));
  console.log("Next steps:");
  console.log("1. Export transcripts from your Swift app using:");
  console.log("   let transcript = session.transcript");
  console.log("   let jsonData = try JSONEncoder().encode(transcript)");
  console.log("2. Load them with fm.loadTranscript(filePath)");
  console.log("3. Analyze with fm.analyzeTranscript(transcript)");
  console.log("4. Compare multiple sessions with fm.compareTranscripts(transcripts)");
  console.log("5. Use insights to improve your Swift app's features");
  console.log("=".repeat(60));
}

main();
