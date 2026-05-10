import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CONFIG_EXAMPLE as BUNDLED_CONFIG_EXAMPLE } from "./config-example.generated.js";

export interface ConfigBootstrapOptions {
  workspaceRoot: string;
  exampleText?: string;
  preferBundledExample?: boolean;
}

function getBundledConfigExample(): string | null {
  return BUNDLED_CONFIG_EXAMPLE.trim().length > 0 ? BUNDLED_CONFIG_EXAMPLE : null;
}

function loadConfigExample(options: ConfigBootstrapOptions): string {
  if (options.exampleText !== undefined) {
    return options.exampleText;
  }

  if (options.preferBundledExample) {
    const bundled = getBundledConfigExample();
    if (bundled !== null) {
      return bundled;
    }
  }

  const examplePath = join(options.workspaceRoot, "config.jsonc.example");
  if (existsSync(examplePath)) {
    return readFileSync(examplePath, "utf-8");
  }

  const bundled = getBundledConfigExample();
  if (bundled !== null) {
    return bundled;
  }

  throw new Error(
    `Unable to initialize config: bundled config example is missing and ${examplePath} does not exist.`,
  );
}

export async function ensureConfigFile(
  configPath: string,
  options: ConfigBootstrapOptions,
): Promise<boolean> {
  if (existsSync(configPath)) {
    return false;
  }

  const example = await loadConfigExample(options);
  mkdirSync(dirname(configPath), { recursive: true });

  try {
    writeFileSync(configPath, example.endsWith("\n") ? example : `${example}\n`, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return false;
    }
    throw error;
  }

  return true;
}
