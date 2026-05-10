#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

const steps = [
  ["shared package", "bun run --filter @meta-search/shared build"],
  ["config package", "bun run --filter @meta-search/config build"],
  ["runtime package", "bun run --filter @meta-search/runtime build"],
  ["web app", "bun run --filter @meta-search/web build"],
  ["embedded assets", "bun ./scripts/embed-assets.mjs"],
  ["embedded config example", "bun ./scripts/embed-config-example.mjs"],
  ["server app", "bun run --filter @meta-search/server build"],
];

for (const [label, cmd] of steps) {
  console.log(`[build-workspace] Building ${label}...`);
  run(cmd);
}
