import process from "node:process";
import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";

import { resolveConfig } from "@meta-search/config";
import type { ResolvedConfig } from "@meta-search/config";
import { KeyPool, createKeyRevokedHandler } from "@meta-search/runtime";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildPatSnapshot, validateBearerToken } from "./middleware/pat-auth.js";
import { createMcpServer, createTransport } from "./mcp/transport.js";
import type { RuntimeState } from "./mcp/transport.js";

// ---------------------------------------------------------------------------
// Proxy Support
// ---------------------------------------------------------------------------

async function setupProxy(): Promise<void> {
  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;

  if (!proxyUrl) return;

  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    process.stderr.write(`[meta-search] Proxy: ${proxyUrl}\n`);
  } catch {
    // undici not available, fall through to direct connection
  }
}

// ---------------------------------------------------------------------------
// Runtime State Initialization
// ---------------------------------------------------------------------------

function buildRuntimeState(config: ResolvedConfig): RuntimeState {
  const healthOpts = {
    recoveryIntervalMs: config.key_recovery_interval_ms,
    maxDisableBeforeRevoke: config.max_disable_before_revoke,
  };

  const invalidKeysPath = join(process.cwd(), config.invalid_keys_file);
  const onKeyRevoked = createKeyRevokedHandler(invalidKeysPath);

  return {
    config,
    tavilyKeyPool: new KeyPool({
      providerName: "tavily",
      keys: config.tavily?.api_keys ?? [],
      strategy: config.key_rotation_strategy,
      health: healthOpts,
      onKeyRevoked,
    }),
    exaKeyPool: new KeyPool({
      providerName: "exa",
      keys: config.exa?.api_keys ?? [],
      strategy: config.key_rotation_strategy,
      health: healthOpts,
      onKeyRevoked,
    }),
    perplexityKeyPool: new KeyPool({
      providerName: "perplexity",
      keys: config.perplexity?.api_keys ?? [],
      strategy: config.key_rotation_strategy,
      health: healthOpts,
      onKeyRevoked,
    }),
    jinaKeyPool: new KeyPool({
      providerName: "jina",
      keys: config.jina?.api_keys ?? [],
      strategy: config.key_rotation_strategy,
      health: healthOpts,
      onKeyRevoked,
    }),
    cloudflareKeyPool: new KeyPool({
      providerName: "cloudflare",
      keys: buildCloudflareCredentials(config),
      strategy: config.key_rotation_strategy,
      health: healthOpts,
      onKeyRevoked,
    }),
    onKeyRevoked,
  };
}

function buildCloudflareCredentials(config: ResolvedConfig): unknown[] {
  if (!Array.isArray(config.cloudflare?.accounts)) return [];
  return config.cloudflare.accounts.map((a) => ({
    accountId: a.account_id,
    token: a.api_token,
  }));
}

// ---------------------------------------------------------------------------
// Startup Summary
// ---------------------------------------------------------------------------

function printStartupSummary(rt: RuntimeState): void {
  const { config } = rt;
  const providers = [
    { name: "Tavily", pool: rt.tavilyKeyPool },
    { name: "Exa", pool: rt.exaKeyPool },
    { name: "Perplexity", pool: rt.perplexityKeyPool },
    { name: "Jina", pool: rt.jinaKeyPool },
    { name: "Cloudflare", pool: rt.cloudflareKeyPool },
  ];

  process.stderr.write("[meta-search] Starting up...\n");
  for (const { name, pool } of providers) {
    const count = pool.size();
    const active = pool.activeSize();
    const status =
      count > 0 ? `${active}/${count} active key(s)` : "not configured";
    process.stderr.write(`[meta-search]   ${name}: ${status}\n`);
  }
  process.stderr.write(
    `[meta-search]   Strategy: ${config.key_rotation_strategy} | ` +
      `Timeout: ${config.request_timeout_ms}ms | ` +
      `Recovery: ${config.key_recovery_interval_ms}ms\n`,
  );
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Setup proxy
  await setupProxy();

  // 2. Load config
  const configPath = process.env.CONFIG_PATH ?? join(process.cwd(), "config.jsonc");
  const config = resolveConfig(configPath);

  // 3. Build runtime state
  const rt = buildRuntimeState(config);

  // 4. Build PAT snapshot
  const patSnapshot = buildPatSnapshot(config.pats);

  // 5. Initialize MCP server and transport
  const mcpServer = createMcpServer(rt);
  const transport = createTransport();
  await mcpServer.connect(transport);

  // 6. Track readiness
  let ready = false;

  // 7. Create Hono app for health endpoints and future routes
  const app = new Hono();

  app.get("/healthz", (c) => c.text("OK"));

  app.get("/readyz", (c) => {
    if (ready) {
      return c.text("OK");
    }
    return c.text("Not ready", 503);
  });

  // 8. Create the Hono request listener
  const honoListener = getRequestListener(app.fetch);

  // 9. Create a raw Node.js HTTP server that routes /mcp to the MCP
  //    transport and everything else to Hono
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Route MCP requests directly to the transport
      if (req.url === "/mcp") {
        // PAT auth check
        if (patSnapshot.hasPats) {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith("Bearer ")) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          const token = authHeader.slice(7);
          if (!validateBearerToken(token, patSnapshot)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
        }

        try {
          await transport.handleRequest(req, res);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[meta-search] MCP transport error: ${msg}\n`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
        return;
      }

      // Everything else goes to Hono
      honoListener(req, res);
    },
  );

  // 10. Start listening
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOST ?? "0.0.0.0";

  server.listen(port, hostname, () => {
    ready = true;
    printStartupSummary(rt);
    process.stderr.write(
      `[meta-search] Listening on http://${hostname}:${port}\n`,
    );
    process.stderr.write("[meta-search] Ready.\n");
  });

  // 11. Graceful shutdown
  setupGracefulShutdown(server, mcpServer);
}

function setupGracefulShutdown(
  server: Server,
  mcpServer: McpServer,
): void {
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    process.stderr.write("[meta-search] Shutting down...\n");

    // Stop accepting new connections
    server.close(() => {
      process.stderr.write("[meta-search] HTTP server closed.\n");
    });

    // Close MCP server
    try {
      await mcpServer.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[meta-search] Error closing MCP server: ${msg}\n`);
    }

    process.stderr.write("[meta-search] Shutdown complete.\n");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[meta-search] Fatal: ${message}\n`);
  process.exit(1);
});
