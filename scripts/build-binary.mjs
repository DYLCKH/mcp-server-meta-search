#!/usr/bin/env bun
/**
 * Build a single-file binary using `bun build --compile`.
 *
 * Usage:
 *   bun ./scripts/build-binary.mjs                    # current platform
 *   bun ./scripts/build-binary.mjs --target bun-linux-x64
 *
 * Supported targets:
 *   bun-linux-x64, bun-linux-arm64,
 *   bun-darwin-x64, bun-darwin-arm64,
 *   bun-windows-x64
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ENTRY = join(ROOT, "apps", "server", "src", "index.ts");
const OUT_DIR = join(ROOT, "dist-bin");

const args = process.argv.slice(2);
let target = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--target" && args[i + 1]) {
    target = args[i + 1];
    i++;
  }
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

// 1. Build web frontend
console.log("[build-binary] Building web frontend...");
run("bun run --filter @meta-search/web build");

// 2. Generate embedded assets
console.log("[build-binary] Embedding web assets...");
run("bun ./scripts/embed-assets.mjs");

// 3. Build workspace packages (shared, config, runtime) so tsup outputs are available
console.log("[build-binary] Building workspace packages...");
run("bun run --filter @meta-search/shared build");
run("bun run --filter @meta-search/config build");
run("bun run --filter @meta-search/runtime build");

// 4. Determine output name
const suffix = target
  ? target.replace("bun-", "").replace(/-/g, "-")
  : `${process.platform}-${process.arch}`;
const ext = target?.includes("windows") ? ".exe" : "";
const outName = `meta-search-${suffix}${ext}`;
const outPath = join(OUT_DIR, outName);

// 5. Compile
const targetFlag = target ? `--target=${target}` : "";
const compileCmd = [
  "bun build",
  "--compile",
  "--compile-exec-argv=--smol",
  targetFlag,
  `--outfile ${outPath}`,
  ENTRY,
].filter(Boolean).join(" ");

console.log(`[build-binary] Compiling → ${outName}`);
run(compileCmd);

// 6. Report
if (existsSync(outPath)) {
  const { statSync } = await import("node:fs");
  const size = statSync(outPath).size;
  console.log(
    `[build-binary] Done: ${outName} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
} else {
  console.error("[build-binary] Build failed — output not found");
  process.exit(1);
}
