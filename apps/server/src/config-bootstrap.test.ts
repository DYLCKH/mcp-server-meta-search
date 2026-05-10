import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ensureConfigFile } from "./config-bootstrap.js";

describe("ensureConfigFile", () => {
  it("writes the example config when the target is missing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-config-bootstrap-"));
    const configPath = join(tempDir, "nested", "config.jsonc");

    try {
      const created = await ensureConfigFile(configPath, {
        workspaceRoot: tempDir,
        exampleText: "{\n  // example\n}\n",
      });

      expect(created).toBe(true);
      expect(readFileSync(configPath, "utf-8")).toBe("{\n  // example\n}\n");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing config", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-config-bootstrap-"));
    const configPath = join(tempDir, "config.jsonc");

    try {
      writeFileSync(configPath, '{ "server": { "port": 4100 } }\n', "utf-8");

      const created = await ensureConfigFile(configPath, {
        workspaceRoot: tempDir,
        exampleText: "{}",
      });

      expect(created).toBe(false);
      expect(readFileSync(configPath, "utf-8")).toBe('{ "server": { "port": 4100 } }\n');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to config.jsonc.example from the workspace root", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-config-bootstrap-"));
    const configPath = join(tempDir, "config.jsonc");
    const examplePath = join(tempDir, "config.jsonc.example");

    try {
      writeFileSync(examplePath, "{\n  // fallback\n}", "utf-8");

      const created = await ensureConfigFile(configPath, {
        workspaceRoot: tempDir,
      });

      expect(created).toBe(true);
      expect(existsSync(configPath)).toBe(true);
      expect(readFileSync(configPath, "utf-8")).toBe("{\n  // fallback\n}\n");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
