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
import { execFileSync, execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBuildVersion } from "./resolve-build-version.mjs";

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

function runFile(command, args, opts = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

const version = resolveBuildVersion({ root: ROOT });

// 1. Build web frontend
console.log("[build-binary] Building web frontend...");
run("bun run --filter @meta-search/web build");

// 2. Generate embedded assets and config example
console.log("[build-binary] Embedding web assets...");
run("bun ./scripts/embed-assets.mjs");
console.log("[build-binary] Embedding config example...");
run("bun ./scripts/embed-config-example.mjs");

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
const compileArgs = [
  "build",
  "--compile",
  "--compile-exec-argv=--smol",
  "--env=META_SEARCH_BUILD_*",
  ...(target ? [`--target=${target}`] : []),
  "--outfile",
  outPath,
  ENTRY,
];

console.log(`[build-binary] Compiling → ${outName}`);
runFile("bun", compileArgs, {
  env: {
    ...process.env,
    META_SEARCH_BUILD_VERSION: version,
  },
});

// 6. Report
if (existsSync(outPath)) {
  const { statSync } = await import("node:fs");
  const size = statSync(outPath).size;
  writeFileSync(join(OUT_DIR, "version.txt"), `${version}\n`, "utf-8");
  writeFileSync(join(OUT_DIR, "versions.txt"), `${version}\n`, "utf-8");
  writeFileSync(join(OUT_DIR, "versons.txt"), `${version}\n`, "utf-8");
  writeFileSync(`${outPath}.version`, `${version}\n`, "utf-8");
  console.log(
    `[build-binary] Done: ${outName} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(`[build-binary] Version: ${version}`);
} else {
  console.error("[build-binary] Build failed — output not found");
  process.exit(1);
}
