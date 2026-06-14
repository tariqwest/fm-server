import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AutostartPlist } from "../src/autostart/AutostartPlist.js";

function makeDefault(): AutostartPlist {
  return new AutostartPlist({
    label: "com.afm-js.serve",
    binaryPath: "/usr/local/bin/afm-js",
    arguments: ["serve", "--port", "11434"],
    stdoutPath: "/Users/x/Library/Logs/afm-js.out.log",
    stderrPath: "/Users/x/Library/Logs/afm-js.err.log",
    workingDirectory: "/Users/x",
  });
}

describe("AutostartPlist.render", () => {
  test("starts with XML prolog + DOCTYPE + <plist> open tag", () => {
    const xml = makeDefault().render();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<!DOCTYPE plist");
    expect(xml).toContain('<plist version="1.0">');
  });

  test("closes cleanly with </plist>", () => {
    const xml = makeDefault().render();
    expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
  });

  test("contains the label as a top-level entry", () => {
    const xml = makeDefault().render();
    expect(xml).toContain("<key>Label</key>");
    expect(xml).toContain("<string>com.afm-js.serve</string>");
  });

  test("ProgramArguments preserves argument order with binary first", () => {
    const plist = new AutostartPlist({
      label: "com.afm-js.serve",
      binaryPath: "/usr/local/bin/afm-js",
      arguments: ["serve", "--port", "1337", "--token", "sk-abc"],
      stdoutPath: "/tmp/o",
      stderrPath: "/tmp/e",
      workingDirectory: "/Users/x",
    });
    const argsBlock = plist
      .render()
      .split("<key>ProgramArguments</key>")[1]
      ?.split("</array>")[0] ?? "";
    const expected = ["/usr/local/bin/afm-js", "serve", "--port", "1337", "--token", "sk-abc"];
    let cursor = 0;
    for (const tok of expected) {
      const idx = argsBlock.indexOf(`<string>${tok}</string>`, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + tok.length;
    }
  });

  test("XML-special characters in arguments are escaped", () => {
    const plist = new AutostartPlist({
      label: "com.afm-js.serve",
      binaryPath: "/usr/local/bin/afm-js",
      arguments: ["serve", "--token", "a&b<c>\"d'e"],
      stdoutPath: "/tmp/o",
      stderrPath: "/tmp/e",
      workingDirectory: "/Users/x",
    });
    const xml = plist.render();
    expect(xml).toContain("<string>a&amp;b&lt;c&gt;&quot;d&apos;e</string>");
    expect(xml.includes('<string>a&b<c>"d\'e</string>')).toBe(false);
  });

  test("RunAtLoad is <true/>", () => {
    const xml = makeDefault().render();
    expect(xml).toContain("<key>RunAtLoad</key>");
    const after = xml.split("<key>RunAtLoad</key>")[1] ?? "";
    expect(after.trim().startsWith("<true/>")).toBe(true);
  });

  test("KeepAlive policy: SuccessfulExit=false, Crashed=true", () => {
    const xml = makeDefault().render();
    expect(xml).toContain("<key>KeepAlive</key>");
    expect(xml).toContain("<key>SuccessfulExit</key>\n        <false/>");
    expect(xml).toContain("<key>Crashed</key>\n        <true/>");
  });

  test("ThrottleInterval is rendered as an integer (launchd rejects strings)", () => {
    const xml = makeDefault().render();
    expect(xml).toContain("<key>ThrottleInterval</key>");
    expect(xml).toContain("<integer>10</integer>");
  });

  test("StandardOutPath and StandardErrorPath are preserved verbatim", () => {
    const plist = new AutostartPlist({
      label: "com.afm-js.serve",
      binaryPath: "/usr/local/bin/afm-js",
      arguments: ["serve"],
      stdoutPath: "/var/log/o.log",
      stderrPath: "/var/log/e.log",
      workingDirectory: "/Users/x",
    });
    const xml = plist.render();
    expect(xml).toContain("<key>StandardOutPath</key>\n    <string>/var/log/o.log</string>");
    expect(xml).toContain("<key>StandardErrorPath</key>\n    <string>/var/log/e.log</string>");
  });

  test("WorkingDirectory is set", () => {
    const xml = makeDefault().render();
    expect(xml).toContain("<key>WorkingDirectory</key>\n    <string>/Users/x</string>");
  });
});

describe("AutostartPlist defaults", () => {
  test("default label is com.afm-js.serve", () => {
    expect(AutostartPlist.defaultLabel).toBe("com.afm-js.serve");
  });

  test("default install path is ~/Library/LaunchAgents/<label>.plist", () => {
    expect(AutostartPlist.defaultInstallPath("/Users/x")).toBe(
      "/Users/x/Library/LaunchAgents/com.afm-js.serve.plist",
    );
  });

  test("default log paths land under ~/Library/Logs", () => {
    expect(AutostartPlist.defaultStdoutPath("/Users/x")).toBe(
      "/Users/x/Library/Logs/afm-js.out.log",
    );
    expect(AutostartPlist.defaultStderrPath("/Users/x")).toBe(
      "/Users/x/Library/Logs/afm-js.err.log",
    );
  });
});

describe("AutostartPlist functional check", () => {
  test("rendered plist round-trips through `plutil -lint`", () => {
    const xml = makeDefault().render();
    const path = join(tmpdir(), `afm-js-plist-test-${Math.random().toString(36).slice(2)}.plist`);
    writeFileSync(path, xml, "utf8");
    try {
      const result = spawnSync("/usr/bin/plutil", ["-lint", path], { encoding: "utf8" });
      if (result.status !== 0) {
        throw new Error(`plutil -lint rejected the rendered plist: ${result.stdout}${result.stderr}`);
      }
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // ignore
      }
    }
  });
});
