import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedOtaConfig } from "@meta-search/config";
import {
  applyOtaUpdate,
  buildOtaUrls,
  detectReleaseAssetName,
  fetchRemoteVersion,
  fetchRemoteVersionCandidates,
} from "./ota.js";

const tempDirs: string[] = [];

function createConfig(overrides: Partial<ResolvedOtaConfig> = {}): ResolvedOtaConfig {
  return {
    enabled: true,
    repository: "owner/repo",
    tag: "dev",
    request_timeout_ms: 1_000,
    restart_delay_ms: 50,
    restart_strategy: "self",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("OTA release helpers", () => {
  it("matches the single-binary release asset names", () => {
    expect(detectReleaseAssetName("linux", "x64")).toBe("meta-search-linux-x64");
    expect(detectReleaseAssetName("darwin", "arm64")).toBe("meta-search-darwin-arm64");
    expect(detectReleaseAssetName("win32", "x64")).toBe("meta-search-windows-x64.exe");
  });

  it("builds direct GitHub release URLs without using the API", () => {
    const urls = buildOtaUrls(createConfig({ asset_name: "meta-search-linux-x64" }));

    expect(urls).toEqual({
      assetName: "meta-search-linux-x64",
      assetUrl: "https://github.com/owner/repo/releases/download/dev/meta-search-linux-x64",
      versionUrl: "https://github.com/owner/repo/releases/download/dev/version.txt",
      versionUrls: [
        "https://github.com/owner/repo/releases/download/dev/version.txt",
        "https://github.com/owner/repo/releases/download/dev/versions.txt",
        "https://github.com/owner/repo/releases/download/dev/versons.txt",
      ],
    });
  });

  it("reads plain text and JSON version files", async () => {
    const plainFetch = vi.fn(async () => new Response("v1.2.3\n")) as unknown as typeof fetch;
    const jsonFetch = vi.fn(async () => new Response('{"version":"v2.0.0"}')) as unknown as typeof fetch;

    await expect(fetchRemoteVersion("https://example.test/version.txt", 1_000, plainFetch))
      .resolves.toBe("v1.2.3");
    await expect(fetchRemoteVersion("https://example.test/version.json", 1_000, jsonFetch))
      .resolves.toBe("v2.0.0");
  });

  it("falls back to versions.txt aliases", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      return String(url).endsWith("versions.txt")
        ? new Response("v3\n")
        : new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(
      fetchRemoteVersionCandidates(
        [
          "https://example.test/version.txt",
          "https://example.test/versions.txt",
          "https://example.test/versons.txt",
        ],
        1_000,
        fetchImpl,
      ),
    ).resolves.toBe("v3");
  });
});

describe("applyOtaUpdate", () => {
  it("downloads, installs, backs up, and records the remote version", async () => {
    vi.stubEnv("META_SEARCH_VERSION", "");
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-ota-"));
    tempDirs.push(tempDir);

    const binaryPath = join(tempDir, "meta-search-linux-x64");
    const versionFile = join(tempDir, "meta-search-linux-x64.version");
    writeFileSync(binaryPath, "old-binary");
    writeFileSync(versionFile, "v1\n");

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("version.txt")) {
        return new Response("v2\n");
      }
      return new Response(new Uint8Array([1, 2, 3]));
    }) as unknown as typeof fetch;

    const result = await applyOtaUpdate(
      createConfig({
        binary_path: binaryPath,
        version_file: versionFile,
        asset_name: "meta-search-linux-x64",
      }),
      { restart: false },
      fetchImpl,
    );

    expect(result.updated).toBe(true);
    expect(result.currentVersion).toBe("v1");
    expect(result.remoteVersion).toBe("v2");
    expect(result.restartScheduled).toBe(false);
    expect(readFileSync(binaryPath)).toEqual(Buffer.from([1, 2, 3]));
    expect(readFileSync(`${binaryPath}.bak`, "utf-8")).toBe("old-binary");
    expect(readFileSync(versionFile, "utf-8")).toBe("v2\n");
  });
});
