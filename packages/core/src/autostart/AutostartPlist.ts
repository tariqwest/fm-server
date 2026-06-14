// ============================================================================
// AutostartPlist.ts — Pure XML-plist generator for `afm-js autostart`.
// Lives in @afm-js/core (no Node-only APIs beyond stdlib) so the generated
// XML can be unit-tested. The afm-js umbrella writes the rendered string to
// ~/Library/LaunchAgents/ and runs `launchctl bootstrap`.
//
// Port of Sources/Core/AutostartPlist.swift.
// ============================================================================

export interface AutostartPlistInit {
  /** Reverse-DNS launchd label, e.g. `com.afm-js.serve`. */
  label: string;
  /** Absolute path to the `afm-js` binary the agent runs. */
  binaryPath: string;
  /** Args appended to `binaryPath` (e.g. `["serve", "--port", "11434"]`). */
  arguments: string[];
  /** Where launchd writes the agent's stdout. */
  stdoutPath: string;
  /** Where launchd writes the agent's stderr. */
  stderrPath: string;
  /** Working directory for the agent process. */
  workingDirectory: string;
}

export class AutostartPlist implements AutostartPlistInit {
  readonly label: string;
  readonly binaryPath: string;
  readonly arguments: string[];
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly workingDirectory: string;

  constructor(init: AutostartPlistInit) {
    this.label = init.label;
    this.binaryPath = init.binaryPath;
    this.arguments = init.arguments;
    this.stdoutPath = init.stdoutPath;
    this.stderrPath = init.stderrPath;
    this.workingDirectory = init.workingDirectory;
  }

  // MARK: - Sensible defaults

  /**
   * Canonical label used by the autostart command. Not tied to any user —
   * the agent runs in the user's GUI domain so the home path scopes it.
   */
  static readonly defaultLabel = "com.afm-js.serve";

  /** Default plist install location under the user's home. */
  static defaultInstallPath(homeDirectory: string, label: string = AutostartPlist.defaultLabel): string {
    return `${homeDirectory}/Library/LaunchAgents/${label}.plist`;
  }

  /** Default stdout log path. */
  static defaultStdoutPath(homeDirectory: string): string {
    return `${homeDirectory}/Library/Logs/afm-js.out.log`;
  }

  /** Default stderr log path. */
  static defaultStderrPath(homeDirectory: string): string {
    return `${homeDirectory}/Library/Logs/afm-js.err.log`;
  }

  // MARK: - XML rendering

  /**
   * Produce the full launchd plist as an XML string. The output is
   * `plutil`-clean and ready to write to disk.
   */
  render(): string {
    const argv = [this.binaryPath, ...this.arguments];
    const argvXML = argv
      .map((a) => `        <string>${escapeXml(a)}</string>`)
      .join("\n");

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
      `<plist version="1.0">`,
      `<dict>`,
      `    <key>Label</key>`,
      `    <string>${escapeXml(this.label)}</string>`,
      ``,
      `    <key>ProgramArguments</key>`,
      `    <array>`,
      argvXML,
      `    </array>`,
      ``,
      `    <key>RunAtLoad</key>`,
      `    <true/>`,
      ``,
      `    <key>KeepAlive</key>`,
      `    <dict>`,
      `        <key>SuccessfulExit</key>`,
      `        <false/>`,
      `        <key>Crashed</key>`,
      `        <true/>`,
      `    </dict>`,
      ``,
      `    <key>ThrottleInterval</key>`,
      `    <integer>10</integer>`,
      ``,
      `    <key>ProcessType</key>`,
      `    <string>Interactive</string>`,
      ``,
      `    <key>StandardOutPath</key>`,
      `    <string>${escapeXml(this.stdoutPath)}</string>`,
      `    <key>StandardErrorPath</key>`,
      `    <string>${escapeXml(this.stderrPath)}</string>`,
      ``,
      `    <key>WorkingDirectory</key>`,
      `    <string>${escapeXml(this.workingDirectory)}</string>`,
      ``,
      `    <key>EnvironmentVariables</key>`,
      `    <dict>`,
      `        <key>PATH</key>`,
      `        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>`,
      `    </dict>`,
      `</dict>`,
      `</plist>`,
      ``,
    ].join("\n");
  }
}

/** Five-entity XML escaping for plist string bodies. `&` first so we don't double-escape. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
