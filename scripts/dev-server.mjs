import process from "node:process";

import {
  findFreePort,
  getDisplayHost,
  getServerHost,
  getServerPort,
  spawnPnpm,
  writeDevState,
  clearDevState,
  waitForExit,
} from "./dev-utils.mjs";

const host = getServerHost();
const preferredPort = getServerPort();
const port = await findFreePort(preferredPort, host);

if (port !== preferredPort) {
  process.stdout.write(
    `[dev] Port ${preferredPort} is busy, server will use ${port}.\n`,
  );
}

process.stdout.write(
  `[dev] Server: http://${getDisplayHost(host)}:${port}\n`,
);

await writeDevState({ serverPort: port });

const child = spawnPnpm(["--filter", "@meta-search/server", "dev"], {
  PORT: String(port),
  HOST: host,
});

process.exitCode = await waitForExit([child]);
await clearDevState(port);
