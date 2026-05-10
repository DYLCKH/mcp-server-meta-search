#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");

export function resolveBuildVersion({
  root = DEFAULT_ROOT,
  env = process.env,
  now = new Date(),
} = {}) {
  const explicit =
    env.META_SEARCH_BUILD_VERSION?.trim() || env.META_SEARCH_VERSION?.trim();
  if (explicit) return explicit;

  const ref = env.GITHUB_REF?.trim() ?? "";
  const refName = env.GITHUB_REF_NAME?.trim() ?? "";
  if (env.GITHUB_REF_TYPE === "tag" && refName) return refName;

  const tagMatch = ref.match(/^refs\/tags\/(.+)$/);
  if (tagMatch?.[1]) return tagMatch[1];

  if ((ref === "refs/heads/main" || refName === "main") && env.GITHUB_RUN_NUMBER) {
    const runNumber = Number.parseInt(env.GITHUB_RUN_NUMBER, 10);
    const runPadded = Number.isFinite(runNumber)
      ? String(runNumber).padStart(4, "0")
      : env.GITHUB_RUN_NUMBER.padStart(4, "0");
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    return `dev-${runPadded}-${dateStr}`;
  }

  const pkg = JSON.parse(
    readFileSync(join(root, "apps", "server", "package.json"), "utf-8"),
  );
  return `${pkg.version}+${resolveGitSha(root, env)}`;
}

function resolveGitSha(root, env) {
  const envSha = env.GITHUB_SHA?.trim();
  if (envSha) return envSha.slice(0, 7);

  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${resolveBuildVersion()}\n`);
}
