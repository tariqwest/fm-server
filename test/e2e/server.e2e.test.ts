// ============================================================================
// server.e2e.test.ts — End-to-end tests against live server instance
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { isNativeAvailable } from "javascript-apple-fm-sdk";

const SERVER_PORT = 19999;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const SERVER_TOKEN = "sk-test-e2e";
const AUTH_HEADERS = {
  Authorization: `Bearer ${SERVER_TOKEN}`,
  "Content-Type": "application/json",
};

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

const describeE2E = isNativeAvailable() ? describe : describe.skip;

describeE2E("E2E: fm-server serve", () => {
  let serverProcess: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    const root = join(import.meta.dirname, "../..");
    const mainJs = join(root, "dist/cli/main.js");
    const entryTs = join(root, "src/entry.ts");
    const { existsSync } = await import("node:fs");

    let command: string;
    let args: string[];
    if (existsSync(mainJs)) {
      command = "node";
      args = [mainJs, "serve", "--port", String(SERVER_PORT), "--token", SERVER_TOKEN];
    } else if (existsSync(entryTs)) {
      // Uncompiled path via tsx — no tsc emit required
      command = join(root, "node_modules/.bin/tsx");
      args = [entryTs, "serve", "--port", String(SERVER_PORT), "--token", SERVER_TOKEN];
    } else {
      throw new Error("Neither dist/cli/main.js nor src/entry.ts found");
    }

    serverProcess = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: root,
    });

    let serverOutput = "";
    serverProcess.stdout?.on("data", (data) => {
      serverOutput += data.toString();
    });
    serverProcess.stderr?.on("data", (data) => {
      serverOutput += data.toString();
    });

    try {
      await waitForServer(SERVER_URL);
    } catch (err) {
      if (serverOutput) {
        console.error("Server output:", serverOutput);
      }
      if (serverProcess.exitCode !== null) {
        throw new Error(`Server exited with code ${serverProcess.exitCode}: ${serverOutput}`);
      }
      throw err;
    }
  }, 20000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  it("health endpoint returns ok", async () => {
    const res = await fetch(`${SERVER_URL}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("model");
  });

  it("models endpoint returns available models", async () => {
    const res = await fetch(`${SERVER_URL}/v1/models`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("object", "list");
    expect(body.data.map((m: { id: string }) => m.id)).toContain("system");
    expect(body.data.map((m: { id: string }) => m.id)).toContain("pcc");
  });

  it("chat completions endpoint accepts requests", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          model: "system",
          messages: [{ role: "user", content: "Hello" }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      expect([200, 400, 500, 503]).toContain(res.status);
    } catch (err) {
      clearTimeout(timeout);
      expect(String(err)).toMatch(/abort|timeout/i);
    }
  }, 10000);

  it("accepts pcc model requests", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${SERVER_URL}/v1/chat/completions`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          model: "pcc",
          messages: [{ role: "user", content: "Hello" }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      // PCC may succeed or fail depending on fm CLI availability, but should not 400
      expect(res.status).not.toBe(400);
    } catch (err) {
      clearTimeout(timeout);
      expect(String(err)).toMatch(/abort|timeout/i);
    }
  }, 15000);

  it("rejects invalid model IDs", async () => {
    const res = await fetch(`${SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        model: "invalid-model-id",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(res.status).toBe(400);
  });
});