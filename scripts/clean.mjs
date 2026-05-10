#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const paths = [
  "dist-bin",
  "apps/server/dist",
  "apps/server/src/embedded-assets.generated.ts",
  "apps/server/src/config-example.generated.ts",
  "apps/web/dist",
  "packages/config/dist",
  "packages/runtime/dist",
  "packages/shared/dist",
  ".dev-runtime/ports.json",
];

for (const relPath of paths) {
  await rm(join(ROOT, relPath), { force: true, recursive: true });
}
