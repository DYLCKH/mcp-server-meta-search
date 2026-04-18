import process from "node:process";

import {
  findFreePort,
  getDisplayHost,
  getServerHost,
  getServerPort,
  getWebHost,
  getWebPort,
  spawnBun,
  writeDevState,
  clearDevState,
  waitForExit,
} from "./dev-utils.mjs";

const serverHost = getServerHost();
const webHost = getWebHost();
const preferredServerPort = getServerPort();
const preferredWebPort = getWebPort();

const serverPort = await findFreePort(preferredServerPort, serverHost);
const webStartPort =
  preferredWebPort === serverPort ? preferredWebPort + 1 : preferredWebPort;
const webPort = await findFreePort(webStartPort, webHost);
const proxyTarget = `http://127.0.0.1:${serverPort}`;

if (serverPort !== preferredServerPort) {
  process.stdout.write(
    `[dev] Port ${preferredServerPort} is busy, server will use ${serverPort}.\n`,
  );
}

if (webPort !== preferredWebPort) {
  process.stdout.write(
    `[dev] Port ${preferredWebPort} is busy, web UI will use ${webPort}.\n`,
  );
}

process.stdout.write(
  `[dev] Server: http://${getDisplayHost(serverHost)}:${serverPort}\n`,
);
process.stdout.write(
  `[dev] Web UI: http://${getDisplayHost(webHost)}:${webPort}/app/\n`,
);

await writeDevState({ serverPort });

const server = spawnBun(["run", "--filter", "@meta-search/server", "dev"], {
  PORT: String(serverPort),
  HOST: serverHost,
});

const web = spawnBun(
  [
    "run",
    "--filter",
    "@meta-search/web",
    "dev",
    "--host",
    webHost,
    "--port",
    String(webPort),
    "--strictPort",
  ],
  {
    VITE_API_PROXY_TARGET: proxyTarget,
  },
);

process.exitCode = await waitForExit([server, web]);
await clearDevState(serverPort);
