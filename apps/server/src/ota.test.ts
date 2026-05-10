import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedOtaConfig } from "@meta-search/config";
import {
  applyOtaUpdate,
  buildOtaUrls,
  checkOtaUpdate,
  detectReleaseAssetName,
  fetchRemoteVersion,
  fetchRemoteVersionCandidates,
  readCurrentVersion,
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

  it("reads the bundled build version before the sidecar version file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-ota-"));
    tempDirs.push(tempDir);
    const versionFile = join(tempDir, "meta-search-linux-x64.version");
    writeFileSync(versionFile, "v1\n");
    vi.stubEnv("META_SEARCH_BUILD_VERSION", "v2+binary");

    expect(readCurrentVersion(versionFile)).toBe("v2+binary");
  });

  it("treats a remote version as installable when the local version is missing", async () => {
    vi.stubEnv("META_SEARCH_BUILD_VERSION", "");
    vi.stubEnv("META_SEARCH_VERSION", "");
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-ota-"));
    tempDirs.push(tempDir);

    const fetchImpl = vi.fn(async () => new Response("v4\n")) as unknown as typeof fetch;

    await expect(
      checkOtaUpdate(
        createConfig({
          version_file: join(tempDir, "missing.version"),
        }),
        fetchImpl,
      ),
    ).resolves.toMatchObject({
      currentVersion: null,
      remoteVersion: "v4",
      updateAvailable: true,
    });
  });
});

describe("applyOtaUpdate", () => {
  it("rejects unsupported runtimes before doing network work", async () => {
    vi.stubEnv("META_SEARCH_BUILD_VERSION", "");
    vi.stubEnv("META_SEARCH_VERSION", "");
    vi.stubEnv("META_SEARCH_OTA_BINARY", "");
    const fetchImpl = vi.fn(async () => new Response("v2\n")) as unknown as typeof fetch;

    await expect(
      applyOtaUpdate(createConfig(), { force: true, restart: false }, fetchImpl),
    ).rejects.toThrow("Set ota.binary_path");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads, installs, backs up, and records the remote version", async () => {
    vi.stubEnv("META_SEARCH_BUILD_VERSION", "");
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

  it("force-installs even when the version check endpoint fails", async () => {
    vi.stubEnv("META_SEARCH_BUILD_VERSION", "");
    vi.stubEnv("META_SEARCH_VERSION", "");
    const tempDir = mkdtempSync(join(tmpdir(), "meta-search-ota-"));
    tempDirs.push(tempDir);

    const binaryPath = join(tempDir, "meta-search-linux-x64");
    const versionFile = `${binaryPath}.version`;
    writeFileSync(binaryPath, "old-binary");

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("version.txt")) {
        return new Response("temporary failure", { status: 503 });
      }
      return new Response(new Uint8Array([9, 8, 7]));
    }) as unknown as typeof fetch;

    const result = await applyOtaUpdate(
      createConfig({
        binary_path: binaryPath,
        asset_name: "meta-search-linux-x64",
      }),
      { force: true, restart: false },
      fetchImpl,
    );

    expect(result.updated).toBe(true);
    expect(result.remoteVersion).toBeNull();
    expect(result.updateAvailable).toBeNull();
    expect(readFileSync(binaryPath)).toEqual(Buffer.from([9, 8, 7]));
    expect(readFileSync(`${binaryPath}.bak`, "utf-8")).toBe("old-binary");
    expect(existsSync(versionFile)).toBe(false);
  });
});
