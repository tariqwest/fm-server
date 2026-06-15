#!/usr/bin/env node
// ============================================================================
// generate-homebrew-formula.js — Generates Homebrew formula for afm-js
//
// Usage:
//   node scripts/generate-homebrew-formula.js [version] [sha256]
//
// Environment variables:
//   AFM_JS_VERSION - override version
//   AFM_JS_SHA256  - override SHA256 hash
//   AFM_JS_HELPER_SHA256 - override helper binary SHA256
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function getVersion() {
  // Try environment variable first
  if (process.env.AFM_JS_VERSION) {
    return process.env.AFM_JS_VERSION;
  }

  // Try command line argument
  const args = process.argv.slice(2);
  if (args[0] && !args[0].startsWith("--")) {
    return args[0];
  }

  // Read from package.json
  const packageJson = JSON.parse(
    readFileSync(join(rootDir, "packages/afm-js/package.json"), "utf-8")
  );
  return packageJson.version;
}

function getGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getSha256() {
  // Try environment variable first
  if (process.env.AFM_JS_SHA256) {
    return process.env.AFM_JS_SHA256;
  }

  // Try command line argument
  const args = process.argv.slice(2);
  if (args[1]) {
    return args[1];
  }

  // Return placeholder for manual replacement
  return "PLACEHOLDER_SHA256";
}

function getHelperSha256() {
  if (process.env.AFM_JS_HELPER_SHA256) {
    return process.env.AFM_JS_HELPER_SHA256;
  }
  return "PLACEHOLDER_HELPER_SHA256";
}

function generateFormula(version, sha256, helperSha256) {
  const url = `https://github.com/tariqwest/afm-js/archive/refs/tags/v${version}.tar.gz`;

  return `class AfmJs < Formula
  desc "Apple Foundation Models for Node.js — OpenAI-compatible HTTP server + CLI"
  homepage "https://github.com/tariqwest/afm-js"
  url "${url}"
  sha256 "${sha256}"
  license "MIT"
  version "${version}"

  depends_on "node" => :build
  depends_on "pnpm" => :build
  depends_on :macos
  depends_on arch: :arm64

  resource "afm-fm-helper" do
    url "https://github.com/tariqwest/afm-js/releases/download/v${version}/afm-fm-helper-arm64-apple-darwin.tar.gz"
    sha256 "${helperSha256}"
  end

  def install
    # Build the project
    system "pnpm", "install"
    system "pnpm", "run", "build"

    # Install Node.js package
    libexec.install Dir["packages/afm-js/dist"], "packages/afm-js/bin"
    
    # Create wrapper script
    (bin/"afm-js").write <<~EOS
      #!/bin/bash
      export AFM_JS_HELPER_PATH="#{opt_prefix}/libexec/afm-fm-helper"
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/afm-js.js" "$@"
    EOS
    chmod 0755, bin/"afm-js"

    # Install helper binary from resource
    resource("afm-fm-helper").stage do
      libexec.install "afm-fm-helper"
    end
    chmod 0755, libexec/"afm-fm-helper"
  end

  def caveats
    <<~EOS
      afm-js requires:
        - macOS 26 (Tahoe) or later
        - Apple Silicon (M1+)
        - Apple Intelligence enabled in System Settings

      To start the server:
        afm-js serve --port 11434

      For autostart with LaunchAgent:
        afm-js autostart --port 11434 --token sk-mine
    EOS
  end

  test do
    # Test that the binary runs
    assert_match "afm-js", shell_output("#{bin}/afm-js --help")
    
    # Test health endpoint if server can start briefly
    # Note: This may fail if Apple Intelligence is not available
  end
end
`;
}

function main() {
  const version = getVersion();
  const sha256 = getSha256();
  const helperSha256 = getHelperSha256();

  console.log(`Generating Homebrew formula for afm-js v${version}...`);

  const formula = generateFormula(version, sha256, helperSha256);

  // Write to file
  const outputPath = join(rootDir, "afm-js.rb");
  writeFileSync(outputPath, formula);

  console.log(`Formula written to: ${outputPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Create a GitHub release with the source tarball");
  console.log("  2. Update the SHA256 in the formula:");
  console.log(`     shasum -a 256 <downloaded-tarball>`);
  console.log("  3. Upload the helper binary:");
  console.log(`     tar -czf afm-fm-helper-arm64-apple-darwin.tar.gz -C helper/.build/release afm-fm-helper`);
  console.log("  4. Commit the formula to your tap:");
  console.log("     git clone https://github.com/tariqwest/homebrew-tap");
  console.log("     cp afm-js.rb homebrew-tap/Formula/");
  console.log("     cd homebrew-tap && git add -A && git commit -m 'Update afm-js to v" + version + "'");
}

main();
