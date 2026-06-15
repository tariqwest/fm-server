// ============================================================================
// HelperProcessManager.ts — Spawn and manage afm-fm-helper serve --socket.
// Mirrors FmProcessManager: the helper now exposes an OpenAI-compatible
// HTTP/1.1 server over a Unix domain socket, exactly like /usr/bin/fm.
// ============================================================================

import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createConnection } from "node:net";

export interface HelperProcess {
  process: ChildProcess;
  socketPath: string;
}

export class HelperProcessManager {
  private process: ChildProcess | null = null;
  private readonly binaryPath: string;
  private readonly socketPath: string;
  private shuttingDown = false;
  private debug: (msg: string) => void;

  constructor(binaryPath: string, socketPath?: string, debug?: (msg: string) => void) {
    this.binaryPath = binaryPath;
    this.socketPath = socketPath ?? this.generateSocketPath();
    this.debug = debug ?? (() => {});
  }

  private generateSocketPath(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `/tmp/afm-js-helper-${timestamp}-${random}.sock`;
  }

  /**
   * Check if a binary path exists and is executable.
   */
  static async isAvailable(binaryPath: string): Promise<boolean> {
    try {
      await access(binaryPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Spawn `afm-fm-helper serve --socket <path>` and wait for it to be ready.
   */
  async spawn(timeoutMs = 10_000): Promise<HelperProcess> {
    try {
      await unlink(this.socketPath);
    } catch {
      // File may not exist yet
    }

    const proc = spawn(this.binaryPath, ["serve", "--socket", this.socketPath], {
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    });

    this.process = proc;

    proc.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString("utf-8").trim();
      if (msg) this.debug(`[helper] ${msg}`);
    });

    await this.waitForReady(timeoutMs);
    this.setupCleanup();

    return { process: proc, socketPath: this.socketPath };
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const conn = createConnection(this.socketPath);
        await new Promise<void>((resolve, reject) => {
          conn.on("connect", () => { conn.destroy(); resolve(); });
          conn.on("error", reject);
        });
        return;
      } catch {
        await delay(100);
      }
    }
    throw new Error(`afm-fm-helper did not become ready within ${timeoutMs}ms`);
  }

  private setupCleanup(): void {
    const cleanup = async () => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      await this.shutdown();
    };
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
    process.on("exit", cleanup);

    this.process?.on("exit", (code) => {
      if (!this.shuttingDown) {
        this.debug(`[helper] process exited unexpectedly (code ${code})`);
      }
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (!this.process?.killed) this.process?.kill("SIGKILL");
          resolve();
        }, 2000);
        this.process?.on("exit", () => { clearTimeout(timeout); resolve(); });
      });
    }
    try { await unlink(this.socketPath); } catch { /* already gone */ }
    this.process = null;
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
