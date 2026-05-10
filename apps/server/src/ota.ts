import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ResolvedOtaConfig } from "@meta-search/config";

export interface OtaUrls {
  assetName: string;
  assetUrl: string;
  versionUrl: string;
  versionUrls: string[];
}

export interface OtaRuntimePaths {
  binaryPath: string;
  versionFile: string;
  explicitBinaryPath: boolean;
  updateSupported: boolean;
  unsupportedReason: string | null;
}

export interface OtaStatus {
  enabled: boolean;
  repository: string;
  tag: string;
  assetName: string;
  assetUrl: string;
  versionUrl: string;
  versionUrls: string[];
  currentVersion: string | null;
  binaryPath: string;
  versionFile: string;
  restartStrategy: ResolvedOtaConfig["restart_strategy"];
  updateSupported: boolean;
  unsupportedReason: string | null;
}

export interface OtaCheckResult extends OtaStatus {
  remoteVersion: string | null;
  updateAvailable: boolean | null;
}

export interface OtaUpdateResult extends OtaCheckResult {
  updated: boolean;
  backupPath: string | null;
  restartScheduled: boolean;
}

export interface OtaUpdateOptions {
  force?: boolean;
  restart?: boolean;
}

const DEFAULT_VERSION_FILE_NAME = "version.txt";
const FALLBACK_VERSION_FILE_NAMES = ["versions.txt", "versons.txt"];

export function detectReleaseAssetName(
  platform = process.platform,
  arch = process.arch,
): string {
  const normalizedArch = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : arch;

  switch (platform) {
    case "linux":
      return `meta-search-linux-${normalizedArch}`;
    case "darwin":
      return `meta-search-darwin-${normalizedArch}`;
    case "win32":
      return `meta-search-windows-${normalizedArch}.exe`;
    default:
      return `meta-search-${platform}-${normalizedArch}`;
  }
}

export function buildOtaUrls(config: ResolvedOtaConfig): OtaUrls {
  const assetName = config.asset_name ?? detectReleaseAssetName();
  const baseUrl = `https://github.com/${config.repository}/releases/download/${encodeURIComponent(config.tag)}`;
  const versionUrl = config.version_url ?? `${baseUrl}/${DEFAULT_VERSION_FILE_NAME}`;
  const versionUrls = config.version_url
    ? [config.version_url]
    : [
        versionUrl,
        ...FALLBACK_VERSION_FILE_NAMES.map((name) => `${baseUrl}/${name}`),
      ];

  return {
    assetName,
    assetUrl: config.asset_url ?? `${baseUrl}/${encodeURIComponent(assetName)}`,
    versionUrl,
    versionUrls,
  };
}

export function resolveOtaRuntimePaths(config: ResolvedOtaConfig): OtaRuntimePaths {
  const explicitBinaryPath =
    Boolean(config.binary_path) || Boolean(process.env.META_SEARCH_OTA_BINARY);
  const binaryPath = resolve(
    config.binary_path ??
      process.env.META_SEARCH_OTA_BINARY ??
      process.execPath,
  );
  const versionFile = resolve(
    config.version_file ??
      process.env.META_SEARCH_VERSION_FILE ??
      `${binaryPath}.version`,
  );
  const executableName = basename(binaryPath).toLowerCase();
  const updateSupported =
    explicitBinaryPath || executableName.startsWith("meta-search");
  const unsupportedReason = updateSupported
    ? null
    : "Set ota.binary_path when the server is not running as a packaged meta-search binary.";

  return {
    binaryPath,
    versionFile,
    explicitBinaryPath,
    updateSupported,
    unsupportedReason,
  };
}

export function readCurrentVersion(versionFile: string): string | null {
  const bundledVersion = readBundledVersion();
  if (bundledVersion) return bundledVersion;

  if (existsSync(versionFile)) {
    const version = readFileSync(versionFile, "utf-8").trim();
    if (version) return version;
  }
  return process.env.META_SEARCH_VERSION?.trim() || null;
}

function readBundledVersion(): string | null {
  return process.env.META_SEARCH_BUILD_VERSION?.trim() || null;
}

export function getOtaStatus(config: ResolvedOtaConfig): OtaStatus {
  const urls = buildOtaUrls(config);
  const paths = resolveOtaRuntimePaths(config);

  return {
    enabled: config.enabled,
    repository: config.repository,
    tag: config.tag,
    assetName: urls.assetName,
    assetUrl: urls.assetUrl,
    versionUrl: urls.versionUrl,
    versionUrls: urls.versionUrls,
    currentVersion: readCurrentVersion(paths.versionFile),
    binaryPath: paths.binaryPath,
    versionFile: paths.versionFile,
    restartStrategy: config.restart_strategy,
    updateSupported: paths.updateSupported,
    unsupportedReason: paths.unsupportedReason,
  };
}

export async function checkOtaUpdate(
  config: ResolvedOtaConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<OtaCheckResult> {
  const status = getOtaStatus(config);
  return checkOtaUpdateFromStatus(status, config.request_timeout_ms, fetchImpl);
}

async function checkOtaUpdateFromStatus(
  status: OtaStatus,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<OtaCheckResult> {
  const remoteVersion = await fetchRemoteVersionCandidates(
    status.versionUrls,
    timeoutMs,
    fetchImpl,
  );

  return {
    ...status,
    remoteVersion,
    updateAvailable: determineUpdateAvailable(status.currentVersion, remoteVersion),
  };
}

function determineUpdateAvailable(
  currentVersion: string | null,
  remoteVersion: string | null,
): boolean | null {
  if (!remoteVersion) return null;
  if (!currentVersion) return true;
  return currentVersion !== remoteVersion;
}

export async function applyOtaUpdate(
  config: ResolvedOtaConfig,
  options: OtaUpdateOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<OtaUpdateResult> {
  if (!config.enabled) {
    throw new Error("OTA is disabled. Enable ota.enabled in config.jsonc first.");
  }

  const status = getOtaStatus(config);
  if (!status.updateSupported) {
    throw new Error(status.unsupportedReason ?? "OTA update is not supported in this runtime.");
  }

  let check: OtaCheckResult;
  try {
    check = await checkOtaUpdateFromStatus(status, config.request_timeout_ms, fetchImpl);
  } catch (err) {
    if (!options.force) throw err;
    check = {
      ...status,
      remoteVersion: null,
      updateAvailable: null,
    };
  }

  if (!options.force && check.updateAvailable === false) {
    return {
      ...check,
      updated: false,
      backupPath: null,
      restartScheduled: false,
    };
  }

  if (!options.force && !check.remoteVersion) {
    throw new Error("Remote version is unavailable. Retry with force=true to update anyway.");
  }

  const tempPath = await downloadReleaseAsset(
    check.assetUrl,
    check.binaryPath,
    config.request_timeout_ms,
    fetchImpl,
  );
  const backupPath = installBinaryUpdate(tempPath, check.binaryPath);

  if (check.remoteVersion) {
    mkdirSync(dirname(check.versionFile), { recursive: true });
    writeFileSync(check.versionFile, `${check.remoteVersion}\n`, "utf-8");
  }

  return {
    ...check,
    updated: true,
    backupPath,
    restartScheduled: options.restart !== false,
  };
}

export async function fetchRemoteVersion(
  versionUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchWithTimeout(versionUrl, timeoutMs, fetchImpl);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Version check failed: HTTP ${response.status}`);
  }

  const text = (await response.text()).trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Plain text version files are the default path.
  }

  return text.split(/\r?\n/, 1)[0]!.trim() || null;
}

export async function fetchRemoteVersionCandidates(
  versionUrls: string[],
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  for (const versionUrl of versionUrls) {
    const version = await fetchRemoteVersion(versionUrl, timeoutMs, fetchImpl);
    if (version) return version;
  }

  return null;
}

async function downloadReleaseAsset(
  assetUrl: string,
  binaryPath: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchWithTimeout(assetUrl, timeoutMs, fetchImpl);
  if (!response.ok) {
    throw new Error(`Release download failed: HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("Release download failed: empty asset");
  }

  const dir = dirname(binaryPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = resolve(dir, `.meta-search-ota-${randomUUID()}`);
  writeFileSync(tempPath, bytes);
  chmodSync(tempPath, 0o755);
  return tempPath;
}

export function installBinaryUpdate(tempPath: string, binaryPath: string): string | null {
  const backupPath = `${binaryPath}.bak`;
  let hasBackup = false;
  let installed = false;

  try {
    if (existsSync(binaryPath)) {
      copyFileSync(binaryPath, backupPath);
      hasBackup = true;
    }
    renameSync(tempPath, binaryPath);
    installed = true;
    chmodSync(binaryPath, 0o755);
    return hasBackup ? backupPath : null;
  } catch (err) {
    if (installed) {
      try {
        if (hasBackup) {
          copyFileSync(backupPath, binaryPath);
          chmodSync(binaryPath, 0o755);
        } else {
          unlinkSync(binaryPath);
        }
      } catch {
        // Preserve the original install error.
      }
    }

    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors and preserve the original install error.
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to install OTA update: ${message}`);
  }
}

export function scheduleRestart(config: ResolvedOtaConfig, binaryPath: string): void {
  const args = getRestartArgs(binaryPath);

  if (config.restart_strategy === "self") {
    spawnRestartChild(binaryPath, args, config.restart_delay_ms);
  }

  setTimeout(() => {
    process.exit(0);
  }, Math.max(50, config.restart_delay_ms)).unref();
}

function getRestartArgs(binaryPath: string): string[] {
  const currentExecutable = process.argv[0] ? resolve(process.argv[0]) : "";
  const execPath = process.execPath ? resolve(process.execPath) : "";
  const targetExecutable = resolve(binaryPath);
  return currentExecutable === targetExecutable || execPath === targetExecutable
    ? process.argv.slice(1)
    : [];
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function spawnRestartChild(
  binaryPath: string,
  args: string[],
  delayMs: number,
): void {
  if (process.platform === "win32") {
    const quotedArgs = args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(",");
    const script = [
      `Start-Sleep -Milliseconds ${delayMs}`,
      `Start-Process -FilePath '${binaryPath.replace(/'/g, "''")}'` +
        (quotedArgs ? ` -ArgumentList @(${quotedArgs})` : ""),
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const delaySeconds = Math.max(0, delayMs / 1000);
  const child = spawn(
    "/bin/sh",
    ["-c", `sleep ${delaySeconds}; exec "$0" "$@"`, binaryPath, ...args],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
}
