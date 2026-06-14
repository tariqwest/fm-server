// ============================================================================
// benchmark.ts — `afm-js benchmark`. Run a small fixed set of prompts
// against the on-device model and print latency + token-throughput numbers.
// `--json` emits a `BenchmarkReport` envelope that's stable across releases.
// ============================================================================

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { HelperProcess, Session } from "@afm-js/server";

interface BenchmarkRun {
  prompt: string;
  /** Wall-clock latency for the full non-streaming response, ms. */
  totalMs: number;
  /** Latency from request issue to first delta, ms. Streamed runs only. */
  firstTokenMs: number;
  /** Bytes of decoded response content. */
  contentBytes: number;
  /** Helper-reported token counts. */
  promptTokens: number;
  completionTokens: number;
  /** Throughput: completion tokens / second. Computed from totalMs. */
  tokensPerSecond: number;
}

interface BenchmarkReport {
  model: string;
  iterations: number;
  runs: BenchmarkRun[];
  /** Summary across runs (excluding the warmup). */
  summary: {
    totalMsMedian: number;
    firstTokenMsMedian: number;
    tokensPerSecondMedian: number;
  };
}

const DEFAULT_PROMPTS = [
  "Say hello in one word.",
  "Write a haiku about Apple Silicon.",
  "Explain the difference between an iterator and a generator in one sentence.",
];

export const benchmarkCommand = defineCommand({
  meta: {
    name: "benchmark",
    description: "Run a small set of prompts and report latency + token throughput.",
  },
  args: {
    iterations: {
      type: "string",
      description: "Number of measured iterations per prompt (default 1).",
    },
    json: {
      type: "boolean",
      description: "Emit a JSON BenchmarkReport envelope.",
    },
    helper: {
      type: "string",
      description: "Override the afm-fm-helper binary path.",
    },
  },
  async run({ args }) {
    const iterations = args.iterations ? Math.max(1, Number(args.iterations)) : 1;
    const helper = new HelperProcess({ binaryPath: resolveHelperPath(args.helper as string | undefined) });
    helper.start();

    const session = await Session.open(helper, "onDevice");
    const runs: BenchmarkRun[] = [];

    if (!args.json) {
      process.stdout.write(
        `afm-js benchmark · ${DEFAULT_PROMPTS.length} prompts × ${iterations} iterations · on-device\n`,
      );
      process.stdout.write("─".repeat(70) + "\n");
    }

    try {
      for (const prompt of DEFAULT_PROMPTS) {
        for (let i = 0; i < iterations; i++) {
          // Streaming run: capture first-token + total latency in one shot.
          let firstTokenMs = 0;
          let totalContent = "";
          let promptTokens = 0;
          let completionTokens = 0;
          const start = performance.now();
          let firstSeen = false;
          for await (const event of session.stream(prompt)) {
            if (event.kind === "delta") {
              if (!firstSeen) {
                firstTokenMs = performance.now() - start;
                firstSeen = true;
              }
              totalContent += event.text;
            } else {
              promptTokens = event.usage.promptTokens;
              completionTokens = event.usage.completionTokens;
            }
          }
          const totalMs = performance.now() - start;
          const tokensPerSecond =
            totalMs > 0 ? (completionTokens / totalMs) * 1000 : 0;
          const run: BenchmarkRun = {
            prompt,
            totalMs: round(totalMs),
            firstTokenMs: round(firstTokenMs),
            contentBytes: Buffer.byteLength(totalContent, "utf8"),
            promptTokens,
            completionTokens,
            tokensPerSecond: round(tokensPerSecond),
          };
          runs.push(run);
          if (!args.json) {
            process.stdout.write(
              `  ${pad(prompt, 50)}  ${ms(run.totalMs)} total · ${ms(run.firstTokenMs)} ttft · ${run.tokensPerSecond} tok/s\n`,
            );
          }
        }
      }
    } finally {
      await session.close();
      await helper.shutdown();
    }

    const summary = summarise(runs);
    const report: BenchmarkReport = {
      model: "apple-foundationmodel",
      iterations,
      runs,
      summary,
    };

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write("─".repeat(70) + "\n");
      process.stdout.write(
        `median: ${ms(summary.totalMsMedian)} total · ${ms(summary.firstTokenMsMedian)} ttft · ${summary.tokensPerSecondMedian} tok/s\n`,
      );
    }
  },
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function ms(n: number): string {
  return `${n.toFixed(1)}ms`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s.slice(0, n - 1)}…` : s + " ".repeat(n - s.length);
}

function summarise(runs: BenchmarkRun[]) {
  if (runs.length === 0) {
    return { totalMsMedian: 0, firstTokenMsMedian: 0, tokensPerSecondMedian: 0 };
  }
  const median = (xs: number[]): number => {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
  };
  return {
    totalMsMedian: median(runs.map((r) => r.totalMs)),
    firstTokenMsMedian: median(runs.map((r) => r.firstTokenMs)),
    tokensPerSecondMedian: median(runs.map((r) => r.tokensPerSecond)),
  };
}

function resolveHelperPath(override?: string): string {
  const candidates = [
    override,
    process.env.AFM_HELPER_PATH,
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "helper",
      ".build",
      "release",
      "afm-fm-helper",
    ),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  process.stderr.write(
    "afm-js: could not locate afm-fm-helper. Set --helper or AFM_HELPER_PATH.\n",
  );
  process.exit(1);
}
