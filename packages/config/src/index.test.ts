import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveConfig", () => {
  it("ignores environment overrides and uses file config only", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-config-"));
    const configPath = join(tempDir, "config.jsonc");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          key_rotation_strategy: "round_robin",
          request_timeout_ms: 30000,
          tavily: {
            api_keys: ["file-key"],
          },
        }),
        "utf-8",
      );

      vi.stubEnv("KEY_ROTATION_STRATEGY", "random");
      vi.stubEnv("REQUEST_TIMEOUT_MS", "12000");
      vi.stubEnv("TAVILY__API_KEYS", '["env-key"]');

      const config = resolveConfig(configPath);

      expect(config.key_rotation_strategy).toBe("round_robin");
      expect(config.request_timeout_ms).toBe(30000);
      expect(config.tavily?.api_keys).toEqual(["file-key"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
