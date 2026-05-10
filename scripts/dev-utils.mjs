import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../packages/config/src/index.ts";

const BUN_BIN = process.env.BUN_BIN || (process.platform === "win32" ? "bun.exe" : "bun");
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPTS_DIR, "..");
const DEV_STATE_FILE = resolve(SCRIPTS_DIR, "..", ".dev-runtime", "ports.json");
let cachedConfig = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPort(value, fallback) {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function getConfig() {
  if (!cachedConfig) {
    cachedConfig = resolveConfig(resolve(PROJECT_ROOT, process.env.CONFIG_PATH ?? "config.jsonc"));
  }

  return cachedConfig;
}

export function getDisplayHost(host) {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

export function getServerHost() {
  return process.env.HOST || getConfig().server.host;
}

export function getServerPort() {
  return toPort(process.env.PORT, getConfig().server.port);
}

export function getWebHost() {
  return process.env.WEB_HOST || "0.0.0.0";
}

export function getWebPort() {
  return toPort(process.env.WEB_PORT, 5173);
}

export async function findFreePort(startPort, host, maxTries = 20) {
  let port = startPort;

  for (let attempt = 0; attempt < maxTries; attempt += 1, port += 1) {
    // Try binding to the real host so the chosen port matches the process
    // we are about to launch.
    const isFree = await new Promise((resolve) => {
      const server = createServer();

      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });

      server.listen(port, host);
    });

    if (isFree) {
      return port;
    }
  }

  throw new Error(`Unable to find a free port starting from ${startPort}`);
}

export async function detectRunningServerPort() {
  const state = await readDevState();
  if (state?.serverPort && (await isHealthyServer(state.serverPort))) {
    return state.serverPort;
  }

  const candidates = [];
  const preferred = toPort(process.env.PORT, 3000);

  for (let port = preferred; port < preferred + 10; port += 1) {
    candidates.push(port);
  }

  for (const port of candidates) {
    if (await isHealthyServer(port)) {
      return port;
    }
  }

  return null;
}

async function isHealthyServer(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 400);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return body.trim() === "OK";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function writeDevState(state) {
  await mkdir(dirname(DEV_STATE_FILE), { recursive: true });
  await writeFile(
    DEV_STATE_FILE,
    JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2),
    "utf8",
  );
}

export async function readDevState() {
  try {
    const content = await readFile(DEV_STATE_FILE, "utf8");
    const parsed = JSON.parse(content);

    if (
      parsed &&
      typeof parsed === "object" &&
      Number.isInteger(parsed.serverPort) &&
      parsed.serverPort > 0
    ) {
      return parsed;
    }
  } catch {
    // Ignore missing or invalid state files.
  }

  return null;
}

export async function clearDevState(serverPort) {
  const current = await readDevState();

  if (current?.serverPort && current.serverPort !== serverPort) {
    return;
  }

  await rm(DEV_STATE_FILE, { force: true });
}

export function spawnBun(args, env = {}) {
  return spawn(BUN_BIN, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });
}

export async function waitForExit(children) {
  let shuttingDown = false;

  const shutdown = (signal = "SIGTERM") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    for (const child of children) {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return new Promise((resolve) => {
    for (const child of children) {
      child.on("exit", async (code, signal) => {
        if (!shuttingDown) {
          shutdown(signal || "SIGTERM");
          await sleep(100);
          resolve(code ?? 0);
          return;
        }

        if (children.every((item) => item.exitCode !== null || item.killed)) {
          resolve(code ?? 0);
        }
      });
    }
  });
}
