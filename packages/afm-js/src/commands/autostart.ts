// ============================================================================
// autostart.ts — `afm-js autostart`. Installs a per-user macOS LaunchAgent
// that starts the OpenAI-compatible server at login and respawns on crash.
// Mirrors apfel-plus's --autostart command.
//
// Why a LaunchAgent (not a LaunchDaemon): FoundationModels / Apple
// Intelligence is only reachable from the logged-in user's GUI session. A
// root daemon would fail every request with a 503.
// ============================================================================

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname } from "node:path";
import { defineCommand } from "citty";
import { AutostartPlist } from "@afm-js/core";

export const autostartCommand = defineCommand({
  meta: {
    name: "autostart",
    description:
      "Install a per-user LaunchAgent so the server starts at login and respawns on crash.",
  },
  args: {
    port: { type: "string", description: "Bind port to embed in the agent's argv." },
    host: { type: "string", description: "Bind host to embed in the agent's argv." },
    token: { type: "string", description: "Bearer token to embed in the agent's argv." },
    mcp: { type: "string", description: "MCP server spec(s) to embed in the agent's argv." },
    pcc: {
      type: "boolean",
      description:
        "Mark PCC-capable agents (informational; per-request routing still happens via the model id).",
    },
    debug: { type: "boolean", description: "Embed --debug in the agent's argv." },
    helper: {
      type: "string",
      description: "Override the afm-fm-helper path embedded in the agent's argv.",
    },
  },
  async run({ args }) {
    const home = homedir();
    const uid = userInfo().uid;

    // The agent runs the absolute path of the currently-running node binary
    // plus the absolute path of this CLI's bin script, so the plist survives
    // a `pnpm install` or workspace move.
    const nodeBin = process.execPath;
    const cliPath = await locateAfmJsBin();

    if (cliPath.includes("/.build/") || cliPath.includes("/node_modules/.pnpm/")) {
      process.stderr.write(
        `afm-js: warning: installing autostart from a workspace path at ${cliPath}.\n` +
          "  Install afm-js to a stable location (e.g. `npm install -g afm-js`) and re-run.\n",
      );
    }

    const label = AutostartPlist.defaultLabel;
    const plistPath = AutostartPlist.defaultInstallPath(home, label);
    const stdoutPath = AutostartPlist.defaultStdoutPath(home);
    const stderrPath = AutostartPlist.defaultStderrPath(home);

    const serveArgs = buildServeArgv(args);
    const plist = new AutostartPlist({
      label,
      binaryPath: nodeBin,
      arguments: [cliPath, ...serveArgs],
      stdoutPath,
      stderrPath,
      workingDirectory: home,
    });

    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(dirname(stdoutPath), { recursive: true });
    writeFileSync(plistPath, plist.render(), { mode: 0o644 });
    process.stderr.write(`afm-js: wrote ${plistPath}\n`);

    const serviceTarget = `gui/${uid}/${label}`;

    // Idempotent: bootout first so re-running --autostart refreshes the config.
    // The bootout returns non-zero on first install (label not loaded), which
    // is fine.
    spawnSync("/bin/launchctl", ["bootout", serviceTarget], { stdio: "ignore" });

    const bootstrap = spawnSync(
      "/bin/launchctl",
      ["bootstrap", `gui/${uid}`, plistPath],
      { encoding: "utf8" },
    );
    if (bootstrap.status !== 0) {
      process.stderr.write(
        `afm-js: launchctl bootstrap failed (exit ${bootstrap.status}): ${bootstrap.stdout}${bootstrap.stderr}\n`,
      );
      process.exit(1);
    }

    process.stderr.write(`afm-js: bootstrap ok — ${serviceTarget}\n`);
    process.stderr.write("  RunAtLoad   : starts at login\n");
    process.stderr.write("  KeepAlive   : respawns on abnormal exit (10s throttle)\n");
    process.stderr.write(`  stdout log  : ${stdoutPath}\n`);
    process.stderr.write(`  stderr log  : ${stderrPath}\n`);
    process.stderr.write("\nManage:\n");
    process.stderr.write(`  launchctl print     ${serviceTarget}\n`);
    process.stderr.write(`  launchctl kickstart -k ${serviceTarget}   # restart\n`);
    process.stderr.write(`  launchctl bootout   ${serviceTarget}   # stop and unload\n`);
  },
});

/** Reconstruct the `serve` subcommand argv from the autostart-call's args. */
function buildServeArgv(args: Record<string, unknown>): string[] {
  const out: string[] = ["serve"];
  if (args.port) {
    out.push("--port", String(args.port));
  }
  if (args.host) {
    out.push("--host", String(args.host));
  }
  if (args.token) {
    out.push("--token", String(args.token));
  }
  if (args.mcp) {
    out.push("--mcp", String(args.mcp));
  }
  if (args.helper) {
    out.push("--helper", String(args.helper));
  }
  if (args.debug) {
    out.push("--debug");
  }
  return out;
}

/**
 * Resolve the absolute path of the `afm-js` CLI bin script.
 * Falls back to walking up from the running command location.
 */
async function locateAfmJsBin(): Promise<string> {
  // The bin shim that started us is process.argv[1] under normal node invocation.
  const argv1 = process.argv[1];
  if (argv1) {
    // If the bin is reached via `npm install -g`, this resolves to the
    // globally-installed shim path which is what we want.
    return argv1;
  }
  return "/usr/local/bin/afm-js";
}
