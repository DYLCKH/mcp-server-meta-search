import process from "node:process";

import {
  detectRunningServerPort,
  findFreePort,
  getDisplayHost,
  getWebHost,
  getWebPort,
  spawnBun,
  waitForExit,
} from "./dev-utils.mjs";

const host = getWebHost();
const preferredPort = getWebPort();
const port = await findFreePort(preferredPort, host);

if (port !== preferredPort) {
  process.stdout.write(
    `[dev] Port ${preferredPort} is busy, web UI will use ${port}.\n`,
  );
}

const detectedServerPort = await detectRunningServerPort();
const proxyTarget =
  process.env.VITE_API_PROXY_TARGET ||
  `http://127.0.0.1:${detectedServerPort ?? 3000}`;

process.stdout.write(`[dev] Web UI: http://${getDisplayHost(host)}:${port}/app/\n`);
process.stdout.write(`[dev] API proxy: ${proxyTarget}\n`);

const child = spawnBun(
  [
    "run",
    "--filter",
    "@meta-search/web",
    "dev",
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    VITE_API_PROXY_TARGET: proxyTarget,
  },
);

process.exitCode = await waitForExit([child]);
