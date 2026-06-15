// ============================================================================
// transcript.ts — Transcript processing utilities
//
// Mirrors python-apple-fm-sdk's transcript processing functionality.
// For analyzing session data exported from Swift Foundation Models apps.
//
// Usage:
//   import { loadTranscript, analyzeTranscript, compareTranscripts } from '@afm-js/core';
//   const transcript = loadTranscript('./transcript.json');
//   const analysis = analyzeTranscript(transcript);
// ============================================================================

import { readFileSync } from "node:fs";

/**
 * Content object within a transcript entry.
 */
export interface TranscriptContent {
  type: "text" | "structure" | string;
  text?: string;
  structure?: {
    content: unknown;
  };
}

/**
 * Tool call within a response entry.
 */
export interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * Single entry in a transcript.
 */
export interface TranscriptEntry {
  id: string;
  role: "instructions" | "user" | "response" | "tool" | string;
  contents?: TranscriptContent[];
  toolCalls?: ToolCall[];
  toolName?: string;
  tools?: unknown[];
  responseFormat?: {
    type: string;
  };
  assets?: string[];
}

/**
 * Transcript structure exported from Swift Foundation Models.
 */
export interface Transcript {
  version: number;
  type: "FoundationModels.Transcript" | string;
  transcript: {
    entries: TranscriptEntry[];
  };
}

/**
 * Analysis results from a transcript.
 */
export interface TranscriptAnalysis {
  totalEntries: number;
  instructionsEntries: number;
  userEntries: number;
  responseEntries: number;
  toolEntries: number;
  totalUserChars: number;
  totalResponseChars: number;
  avgUserEntryLength: number;
  avgResponseEntryLength: number;
  toolCallsCount: number;
  hasTools: boolean;
  availableToolsCount: number;
  hasStructuredOutput: boolean;
  uniqueAssets: number;
}

/**
 * Comparison results for multiple transcripts.
 */
export interface TranscriptComparison {
  count: number;
  avgEntries: number;
  avgUserEntries: number;
  avgResponseEntries: number;
  avgUserChars: number;
  avgResponseChars: number;
  toolUsageRate: number;
  structuredOutputRate: number;
}

/**
 * Load a transcript from a JSON file.
 * Mirrors python-apple-fm-sdk's load_transcript() function.
 *
 * Swift code to export transcript:
 * ```swift
 * import FoundationModels
 *
 * let transcript = session.transcript
 * let jsonData = try JSONEncoder().encode(transcript)
 * try jsonData.write(to: URL(fileURLWithPath: "transcript.json"))
 * ```
 */
export function loadTranscript(filePath: string): Transcript {
  const data = readFileSync(filePath, "utf-8");
  return JSON.parse(data) as Transcript;
}

/**
 * Load a transcript from a JSON string.
 */
export function parseTranscript(jsonString: string): Transcript {
  return JSON.parse(jsonString) as Transcript;
}

/**
 * Extract text from a contents array.
 */
export function extractTextFromContents(contents: TranscriptContent[]): string {
  const textParts: string[] = [];

  for (const content of contents) {
    if (content.type === "text" && content.text) {
      textParts.push(content.text);
    } else if (content.type === "structure" && content.structure) {
      // For structured content, convert to string representation
      textParts.push(JSON.stringify(content.structure.content));
    }
  }

  return textParts.join(" ");
}

/**
 * Analyze a transcript and extract key metrics.
 * Mirrors python-apple-fm-sdk's analyze_transcript() function.
 */
export function analyzeTranscript(transcript: Transcript): TranscriptAnalysis {
  const entries = transcript.transcript?.entries ?? [];

  // Count entry types by role
  const instructionsEntries = entries.filter((e) => e.role === "instructions");
  const userEntries = entries.filter((e) => e.role === "user");
  const responseEntries = entries.filter((e) => e.role === "response");
  const toolEntries = entries.filter((e) => e.role === "tool");

  // Calculate content lengths
  const totalUserChars = userEntries.reduce(
    (sum, e) => sum + extractTextFromContents(e.contents ?? []).length,
    0
  );
  const totalResponseChars = responseEntries.reduce(
    (sum, e) => sum + extractTextFromContents(e.contents ?? []).length,
    0
  );

  // Extract tool calls from response entries
  const toolCalls: ToolCall[] = [];
  for (const entry of responseEntries) {
    if (entry.toolCalls) {
      toolCalls.push(...entry.toolCalls);
    }
  }

  // Extract available tools from instructions
  const availableTools: unknown[] = [];
  for (const entry of instructionsEntries) {
    if (entry.tools) {
      availableTools.push(...entry.tools);
    }
  }

  // Check for structured output (responseFormat)
  const hasStructuredOutput = userEntries.some((e) => "responseFormat" in e);

  // Check for assets (model information)
  const assets: string[] = [];
  for (const entry of responseEntries) {
    if (entry.assets) {
      assets.push(...entry.assets);
    }
  }

  return {
    totalEntries: entries.length,
    instructionsEntries: instructionsEntries.length,
    userEntries: userEntries.length,
    responseEntries: responseEntries.length,
    toolEntries: toolEntries.length,
    totalUserChars,
    totalResponseChars,
    avgUserEntryLength: userEntries.length > 0 ? totalUserChars / userEntries.length : 0,
    avgResponseEntryLength: responseEntries.length > 0 ? totalResponseChars / responseEntries.length : 0,
    toolCallsCount: toolCalls.length,
    hasTools: toolCalls.length > 0,
    availableToolsCount: availableTools.length,
    hasStructuredOutput,
    uniqueAssets: new Set(assets).size,
  };
}

/**
 * Print a formatted summary of the transcript.
 */
export function printTranscriptSummary(transcript: Transcript, analysis: TranscriptAnalysis): void {
  console.log("=".repeat(60));
  console.log("TRANSCRIPT SUMMARY");
  console.log("=".repeat(60));

  // Transcript metadata
  const version = transcript.version ?? "N/A";
  const transcriptType = transcript.type ?? "N/A";
  console.log(`\nVersion: ${version}`);
  console.log(`Type: ${transcriptType}`);

  // Entry statistics
  console.log("\nEntry Statistics:");
  console.log(`  Total entries: ${analysis.totalEntries}`);
  console.log(`  Instructions entries: ${analysis.instructionsEntries}`);
  console.log(`  User entries: ${analysis.userEntries}`);
  console.log(`  Response entries: ${analysis.responseEntries}`);
  console.log(`  Tool entries: ${analysis.toolEntries}`);

  // Content statistics
  console.log("\nContent Statistics:");
  console.log(`  Total user characters: ${analysis.totalUserChars}`);
  console.log(`  Total response characters: ${analysis.totalResponseChars}`);
  console.log(`  Avg user entry length: ${analysis.avgUserEntryLength.toFixed(1)} chars`);
  console.log(`  Avg response entry length: ${analysis.avgResponseEntryLength.toFixed(1)} chars`);

  // Tool usage
  if (analysis.hasTools) {
    console.log("\nTool Usage:");
    console.log(`  Available tools: ${analysis.availableToolsCount}`);
    console.log(`  Tool calls made: ${analysis.toolCallsCount}`);
  }

  // Structured output
  if (analysis.hasStructuredOutput) {
    console.log("\nStructured Output: Yes (JSON Schema)");
  }

  // Model assets
  if (analysis.uniqueAssets > 0) {
    console.log(`\nModel Assets: ${analysis.uniqueAssets} unique asset(s)`);
  }

  console.log("=".repeat(60));
}

/**
 * Print the first few entries from the transcript.
 */
export function printTranscriptEntries(transcript: Transcript, maxEntries = 5): void {
  const entries = transcript.transcript?.entries ?? [];

  console.log(`\nFirst ${Math.min(maxEntries, entries.length)} entries:`);
  console.log("-".repeat(60));

  for (let i = 0; i < Math.min(maxEntries, entries.length); i++) {
    const entry = entries[i]!;
    const role = entry.role ?? "unknown";
    const entryId = entry.id ?? "N/A";

    console.log(`\n[${i + 1}] ${role.toUpperCase()} (ID: ${entryId.slice(0, 8)}...)`);

    // Show contents
    if (entry.contents) {
      const text = extractTextFromContents(entry.contents);
      const truncated = text.length > 100 ? text.slice(0, 100) + "..." : text;
      if (truncated) {
        console.log(`    Content: ${truncated}`);
      }
    }

    // Show tool calls if present
    if (entry.toolCalls) {
      for (const toolCall of entry.toolCalls) {
        console.log(`    [Tool Call: ${toolCall.name}]`);
      }
    }

    // Show tool name if this is a tool response
    if (entry.toolName) {
      console.log(`    [Tool Response: ${entry.toolName}]`);
    }

    // Show available tools if present
    if (entry.tools) {
      console.log(`    [Available Tools: ${entry.tools.length}]`);
    }

    // Show response format if present
    if (entry.responseFormat) {
      console.log(`    [Response Format: ${entry.responseFormat.type}]`);
    }
  }

  if (entries.length > maxEntries) {
    console.log(`\n... and ${entries.length - maxEntries} more entries`);
  }

  console.log("-".repeat(60));
}

/**
 * Compare multiple transcripts and generate comparison metrics.
 * Mirrors python-apple-fm-sdk's compare_transcripts() function.
 */
export function compareTranscripts(transcripts: Transcript[]): TranscriptComparison {
  const analyses = transcripts.map((t) => analyzeTranscript(t));

  return {
    count: transcripts.length,
    avgEntries: analyses.reduce((sum, a) => sum + a.totalEntries, 0) / analyses.length,
    avgUserEntries: analyses.reduce((sum, a) => sum + a.userEntries, 0) / analyses.length,
    avgResponseEntries: analyses.reduce((sum, a) => sum + a.responseEntries, 0) / analyses.length,
    avgUserChars: analyses.reduce((sum, a) => sum + a.totalUserChars, 0) / analyses.length,
    avgResponseChars: analyses.reduce((sum, a) => sum + a.totalResponseChars, 0) / analyses.length,
    toolUsageRate: analyses.filter((a) => a.hasTools).length / analyses.length,
    structuredOutputRate: analyses.filter((a) => a.hasStructuredOutput).length / analyses.length,
  };
}

/**
 * Export transcript analyses to JSONL for further processing.
 */
export function exportAnalysisToJsonl(transcripts: Transcript[], outputFile: string): void {
  const { appendFileSync } = require("node:fs");

  for (let i = 0; i < transcripts.length; i++) {
    const transcript = transcripts[i]!;
    const analysis = analyzeTranscript(transcript);
    const record = {
      ...analysis,
      transcriptId: i + 1,
      version: transcript.version ?? 1,
      type: transcript.type ?? "unknown",
    };
    appendFileSync(outputFile, JSON.stringify(record) + "\n");
  }

  console.log(`\n✓ Exported ${transcripts.length} transcript analyses to ${outputFile}`);
}
