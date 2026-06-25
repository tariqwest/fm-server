#!/usr/bin/env node
import("../dist/cli/main.js").catch((err) => {
  process.stderr.write(`fm-server: failed to start - ${err?.stack ?? err}\n`);
  process.exit(1);
});