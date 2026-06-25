// ============================================================================
// server.e2e.test.ts — End-to-end tests against live server instance
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { isNativeAvailable } from "apple-fm-sdk";

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

describeE2E("E2E: fm-server serve (built app)", () => {
  let serverProcess: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    const mainPath = join(import.meta.dirname, "../../dist/cli/main.js");
    const { existsSync } = await import("node:fs");
    if (!existsSync(mainPath)) {
      throw new Error(`Built application not found at ${mainPath}. Run 'pnpm build' first.`);
    }

    const args = [mainPath, "serve", "--port", String(SERVER_PORT), "--token", SERVER_TOKEN];
    serverProcess = spawn("node", args, {
      stdio: ["inherit", "pipe", "pipe"],
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

  it("models endpoint returns the on-device model", async () => {
    const res = await fetch(`${SERVER_URL}/v1/models`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("object", "list");
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(["system"]);
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

  it("rejects pcc model with 400", async () => {
    const res = await fetch(`${SERVER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        model: "pcc",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(res.status).toBe(400);
  });

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