#!/usr/bin/env node
// ============================================================================
// release.js — Complete release workflow for afm-js
//
// Usage:
//   node scripts/release.js [version]
//
// Environment variables:
//   GITHUB_TOKEN - GitHub personal access token (required)
//   DRY_RUN - Set to "true" to skip actual GitHub operations
// ============================================================================

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, createReadStream } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = dirname(__dirname);

// Parse arguments
const versionArg = process.argv[2];
const VERSION = versionArg || JSON.parse(readFileSync(join(ROOT_DIR, "packages/afm-js/package.json"), "utf-8")).version;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DRY_RUN = process.env.DRY_RUN === "true";
const REPO = "tariqwest/afm-js";

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

function logInfo(message) {
  console.log(`${colors.green}[INFO]${colors.reset} ${message}`);
}

function logWarn(message) {
  console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
}

function logError(message) {
  console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
}

function logStep(message) {
  console.log(`${colors.blue}[STEP]${colors.reset} ${message}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: "utf-8", ...options });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

function execSilent(command, options = {}) {
  try {
    return execSync(command, { encoding: "utf-8", stdio: "pipe", ...options });
  } catch (error) {
    return null;
  }
}

function calculateSha256(filePath) {
  const hash = createHash("sha256");
  const data = readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

// GitHub API helpers
async function githubRequest(endpoint, options = {}) {
  const url = `https://api.github.com/repos/${REPO}${endpoint}`;
  const headers = {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "afm-js-release-script",
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}\n${error}`);
  }

  return response.json();
}

async function createRelease(tag, name, body) {
  logStep(`Creating GitHub release for ${tag}...`);
  
  if (DRY_RUN) {
    logWarn("DRY RUN: Skipping release creation");
    return { upload_url: "https://uploads.github.com/repos/tariqwest/afm-js/releases/123/assets{?name}" };
  }

  return githubRequest("/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: name,
      body: body,
      draft: false,
      prerelease: false,
    }),
  });
}

async function uploadAsset(release, filePath, contentType) {
  const fileName = basename(filePath);
  logStep(`Uploading ${fileName} to GitHub release...`);
  
  if (DRY_RUN) {
    logWarn(`DRY RUN: Skipping upload of ${fileName}`);
    return { browser_download_url: `https://github.com/${REPO}/releases/download/v${VERSION}/${fileName}` };
  }

  const uploadUrl = release.upload_url.replace("{?name}", `?name=${fileName}`);
  const fileStream = createReadStream(filePath);
  const fileBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    fileStream.on("data", (chunk) => chunks.push(chunk));
    fileStream.on("end", () => resolve(Buffer.concat(chunks)));
    fileStream.on("error", reject);
  });

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": contentType,
      "Content-Length": fileBuffer.length,
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload ${fileName}: ${response.status} ${response.statusText}\n${error}`);
  }

  return response.json();
}

async function main() {
  logInfo(`Starting release process for afm-js v${VERSION}...`);
  
  if (!GITHUB_TOKEN) {
    logError("GITHUB_TOKEN environment variable is required");
    process.exit(1);
  }

  if (DRY_RUN) {
    logWarn("DRY RUN mode enabled - no actual changes will be made");
  }

  // Create temporary directory for artifacts
  const tempDir = join(ROOT_DIR, ".release-temp");
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  mkdirSync(tempDir, { recursive: true });

  try {
    // Step 1: Build the project
    logStep("Building afm-js package...");
    exec("pnpm run build", { cwd: ROOT_DIR });

    // Step 2: Build the Swift helper
    logStep("Building afm-fm-helper binary...");
    exec("swift build -c release", { cwd: join(ROOT_DIR, "helper") });

    // Step 3: Create afm-js tarball
    logStep("Creating afm-js prebuilt tarball...");
    const afmJsTarball = join(tempDir, `afm-js-prebuilt-arm64-apple-darwin-${VERSION}.tar.gz`);
    exec(
      `tar -czf "${afmJsTarball}" -C packages/afm-js dist bin`,
      { cwd: ROOT_DIR }
    );

    // Step 4: Create helper tarball
    logStep("Creating afm-fm-helper tarball...");
    const helperTarball = join(tempDir, `afm-fm-helper-arm64-apple-darwin-${VERSION}.tar.gz`);
    exec(
      `tar -czf "${helperTarball}" -C helper/.build/release afm-fm-helper`,
      { cwd: ROOT_DIR }
    );

    // Step 5: Calculate SHA256 hashes
    logStep("Calculating SHA256 hashes...");
    const afmJsSha256 = calculateSha256(afmJsTarball);
    const helperSha256 = calculateSha256(helperTarball);
    logInfo(`afm-js SHA256: ${afmJsSha256}`);
    logInfo(`helper SHA256: ${helperSha256}`);

    // Step 6: Create GitHub release
    const tagName = `v${VERSION}`;
    const releaseName = `afm-js ${VERSION}`;
    const releaseBody = `afm-js ${VERSION}

## Installation

\`\`\`bash
brew install tariqwest/tap/afm-js
\`\`\`

## What's Changed

See the [CHANGELOG](https://github.com/${REPO}/blob/main/CHANGELOG.md) for details.

## Artifacts

- \`afm-js-prebuilt-arm64-apple-darwin-${VERSION}.tar.gz\` - Prebuilt Node.js package
- \`afm-fm-helper-arm64-apple-darwin-${VERSION}.tar.gz\` - Swift helper binary

## Requirements

- macOS 26 (Tahoe) or later
- Apple Silicon (M1+)
- Apple Intelligence enabled in System Settings
`;

    const release = await createRelease(tagName, releaseName, releaseBody);
    logInfo(`Release created: ${release.html_url}`);

    // Step 7: Upload artifacts
    const afmJsAsset = await uploadAsset(release, afmJsTarball, "application/gzip");
    const helperAsset = await uploadAsset(release, helperTarball, "application/gzip");
    
    logInfo(`afm-js artifact: ${afmJsAsset.browser_download_url}`);
    logInfo(`helper artifact: ${helperAsset.browser_download_url}`);

    // Step 8: Generate Homebrew formula with SHA256 hashes
    logStep("Generating Homebrew formula...");
    process.env.AFM_JS_VERSION = VERSION;
    process.env.AFM_JS_SHA256 = afmJsSha256;
    process.env.AFM_JS_HELPER_SHA256 = helperSha256;
    
    exec("node scripts/generate-homebrew-formula.js", { cwd: ROOT_DIR });

    // Step 9: Publish to tap
    logStep("Publishing formula to Homebrew tap...");
    exec("node scripts/publish-to-tap.js", { cwd: ROOT_DIR, args: [VERSION] });

    logInfo(`Release ${VERSION} completed successfully!`);
    console.log("");
    console.log("Release artifacts:");
    console.log(`  - ${afmJsAsset.browser_download_url}`);
    console.log(`  - ${helperAsset.browser_download_url}`);
    console.log("");
    console.log("Homebrew formula updated and published to tap.");
    console.log("Users can install via:");
    console.log("  brew install tariqwest/tap/afm-js");

  } finally {
    // Cleanup temporary directory
    if (existsSync(tempDir)) {
      logStep("Cleaning up temporary directory...");
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  logError(error.message);
  process.exit(1);
});
