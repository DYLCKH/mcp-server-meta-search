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
          server: {
            host: "127.0.0.1",
            port: 4100,
          },
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
      vi.stubEnv("HOST", "0.0.0.0");
      vi.stubEnv("PORT", "9000");

      const config = resolveConfig(configPath);

      expect(config.server.host).toBe("127.0.0.1");
      expect(config.server.port).toBe(4100);
      expect(config.key_rotation_strategy).toBe("round_robin");
      expect(config.request_timeout_ms).toBe(30000);
      expect(config.tavily?.api_keys).toEqual(["file-key"]);
      expect(config.performance.cache.maxSize).toBe(128);
      expect(config.performance.cache.maxBytes).toBe(8 * 1024 * 1024);
      expect(config.performance.cache.maxEntryBytes).toBe(256 * 1024);
      expect(config.performance.concurrency.maxConcurrency).toBe(8);
      expect(config.performance.concurrency.maxQueueSize).toBe(64);
      expect(config.ota.enabled).toBe(true);
      expect(config.ota.repository).toBe("DYLCKH/mcp-server-meta-search");
      expect(config.ota.tag).toBe("dev");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses default server listen settings when omitted", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-config-"));
    const configPath = join(tempDir, "config.jsonc");

    try {
      writeFileSync(configPath, "{}", "utf-8");

      const config = resolveConfig(configPath);

      expect(config.server.host).toBe("0.0.0.0");
      expect(config.server.port).toBe(3000);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
