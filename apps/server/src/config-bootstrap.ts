import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ConfigBootstrapOptions {
  workspaceRoot: string;
  exampleText?: string;
  preferBundledExample?: boolean;
}

async function loadGeneratedConfigExample(): Promise<string | null> {
  try {
    const mod = await import("./config-example.generated.js");
    return typeof mod.CONFIG_EXAMPLE === "string" ? mod.CONFIG_EXAMPLE : null;
  } catch {
    return null;
  }
}

async function loadConfigExample(options: ConfigBootstrapOptions): Promise<string> {
  if (options.exampleText !== undefined) {
    return options.exampleText;
  }

  if (options.preferBundledExample) {
    const generated = await loadGeneratedConfigExample();
    if (generated !== null) {
      return generated;
    }
  }

  const examplePath = join(options.workspaceRoot, "config.jsonc.example");
  if (existsSync(examplePath)) {
    return readFileSync(examplePath, "utf-8");
  }

  const generated = await loadGeneratedConfigExample();
  if (generated !== null) {
    return generated;
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
