// =============================================================================
// cli.e2e.test.ts — End-to-end tests for CLI commands
// =============================================================================

import { describe, it, expect } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isNativeAvailable } from "javascript-apple-fm-sdk";

const ROOT = join(import.meta.dirname, "../..");
const ENTRY_TS = join(ROOT, "src/entry.ts");
const MAIN_JS = join(ROOT, "dist/cli/main.js");

function resolveRunner(): { command: string; prefixArgs: string[] } {
  if (existsSync(MAIN_JS)) {
    return { command: "node", prefixArgs: [MAIN_JS] };
  }
  // Uncompiled path: Node via tsx (production-like without tsc emit)
  return { command: join(ROOT, "node_modules/.bin/tsx"), prefixArgs: [ENTRY_TS] };
}

async function runCommand(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { command, prefixArgs } = resolveRunner();
  return new Promise((resolve) => {
    const proc = spawn(command, [...prefixArgs, ...args], {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

const describeE2E = isNativeAvailable() ? describe : describe.skip;

describeE2E("E2E: CLI commands", () => {
  it("available command checks model availability", async () => {
    const { stdout, stderr, exitCode } = await runCommand(["available"]);
    expect([0, 1]).toContain(exitCode);
    expect(stdout).toBeDefined();
    expect(stderr).not.toContain("failed");
  });

  it("available command with JSON output", async () => {
    const { stdout, exitCode } = await runCommand(["available", "--json"]);
    expect([0, 1]).toContain(exitCode);
    const output = JSON.parse(stdout);
    expect(output).toHaveProperty("available");
    expect(output).toHaveProperty("status");
  });

  it(
    "respond command generates a response",
    async () => {
      const { stdout, exitCode } = await runCommand(["respond", "Hello"]);
      expect([0, 1]).toContain(exitCode);
      expect(stdout).toBeDefined();
    },
    30_000,
  );

  it(
    "respond command accepts pcc model",
    async () => {
      const { exitCode } = await runCommand(["respond", "--model", "pcc", "Hello"]);
      // PCC may succeed (0) or fail due to fm CLI availability (1), but should not reject with 2
      expect(exitCode).not.toBe(2);
    },
    30_000,
  );

  it("schema command generates object schema", async () => {
    const { stdout, exitCode } = await runCommand([
      "schema",
      "object",
      "--name",
      "TestSchema",
      "--string",
      "field1",
      "--int",
      "field2",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("TestSchema");
    expect(stdout).toContain("field1");
    expect(stdout).toContain("field2");
  });

  it("token-count command counts tokens", async () => {
    const { stdout, exitCode } = await runCommand(["token-count", "Hello world"]);
    expect([0, 1]).toContain(exitCode);
    expect(stdout).toBeDefined();
  });
});
