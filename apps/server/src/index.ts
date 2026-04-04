import process from "node:process";
import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";

import { resolveConfig } from "@meta-search/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildPatSnapshot, validateBearerToken } from "./middleware/pat-auth.js";
import type { PatSnapshot } from "./middleware/pat-auth.js";
import { createMcpServer, createTransport } from "./mcp/transport.js";
import type { RuntimeState } from "./mcp/transport.js";
import {
  initDatabase,
  closeDatabase,
  logAuditEvent,
  queryRequestLogs,
  queryAuditLogs,
  getRequestStats,
} from "./db/index.js";
import type {
  RequestLogFilters as DbRequestLogFilters,
  AuditLogFilters as DbAuditLogFilters,
} from "./db/index.js";
import { createAdminRouter } from "./admin/router.js";
import type { AdminDeps, DbHandle } from "./admin/types.js";
import { resolveAppPath, resolveStaticAssetPath } from "./path-utils.js";
import { buildRuntimeState } from "./runtime-state.js";

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

const SERVER_MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SERVER_MODULE_DIR, "..", "..", "..");

// ---------------------------------------------------------------------------
// DB Handle Adapter
// ---------------------------------------------------------------------------

function createDbHandle(): DbHandle {
  return {
    queryRequestLogs(filters) {
      return queryRequestLogs(filters as DbRequestLogFilters);
    },
    queryAuditLogs(filters) {
      return queryAuditLogs(filters as DbAuditLogFilters);
    },
    insertAuditLog(entry) {
      logAuditEvent({
        action: entry.action,
        actor: "admin",
        target_type: entry.target_type,
        target_id: entry.target_name,
        details: entry.detail,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Static File Serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStaticFile(
  res: ServerResponse,
  filePath: string,
): Promise<boolean> {
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Startup Summary
// ---------------------------------------------------------------------------

function printStartupSummary(rt: RuntimeState): void {
  const { config, perf } = rt;
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

  if (perf) {
    const pc = config.performance;
    const parts: string[] = [];
    if (pc.cache.enabled) parts.push(`cache(max=${pc.cache.maxSize},ttl=${pc.cache.defaultTtlMs}ms)`);
    if (pc.circuitBreaker.enabled) parts.push(`cb(threshold=${pc.circuitBreaker.failureThreshold})`);
    if (pc.singleFlight.enabled) parts.push("single-flight");
    parts.push(`concurrency(${pc.concurrency.maxConcurrency})`);
    if (parts.length > 0) {
      process.stderr.write(`[meta-search]   Perf: ${parts.join(", ")}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Setup proxy
  await setupProxy();

  // 2. Load config
  const configPath = resolveAppPath(
    process.env.CONFIG_PATH ?? "config.jsonc",
    WORKSPACE_ROOT,
  );
  const configDir = dirname(configPath);
  const config = resolveConfig(configPath);

  // 3. Build runtime state
  const rt = buildRuntimeState(config, configDir);

  // 4. Build PAT snapshot
  const patSnapshot = buildPatSnapshot(config.pats);

  // 5. Initialize database
  const dbPath = resolveAppPath(
    process.env.LOGS_DB_PATH ?? "logs.db",
    WORKSPACE_ROOT,
  );
  initDatabase(dbPath);
  const dbHandle = createDbHandle();

  // 6. Initialize MCP server and transport
  const mcpServer = createMcpServer(rt);
  const transport = createTransport();
  await mcpServer.connect(transport);

  // 7. Track readiness
  let ready = false;

  // 8. Create mutable refs for admin
  const runtimeStateRef: { current: RuntimeState } = { current: rt };
  const patSnapshotRef: { current: PatSnapshot } = { current: patSnapshot };

  // 9. Create admin router
  const adminDeps: AdminDeps = {
    configPath,
    runtimeState: runtimeStateRef,
    patSnapshot: patSnapshotRef,
    db: dbHandle,
  };
  const adminRouter = createAdminRouter(adminDeps);

  // 10. Create Hono app
  const app = new Hono();

  app.get("/healthz", (c) => c.text("OK"));

  app.get("/readyz", (c) => {
    if (ready) {
      return c.text("OK");
    }
    return c.text("Not ready", 503);
  });

  app.get("/metrics", (c) => {
    const metrics = runtimeStateRef.current.perf?.metrics;
    if (!metrics) {
      return c.text("", 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    }
    const text = metrics.getPrometheusMetrics();
    return c.text(text, 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  });

  // Mount admin API routes
  app.route("/api/admin", adminRouter);

  // 11. Create the Hono request listener
  const honoListener = getRequestListener(app.fetch);

  // 12. Determine WebUI static root
  const webRoot = join(WORKSPACE_ROOT, "apps", "web", "public");

  // 13. Create a raw Node.js HTTP server that routes /mcp to the MCP
  //     transport, /app/* to static files, and everything else to Hono
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url?.split("?")[0] ?? "/";

      // Route MCP requests directly to the transport
      if (url === "/mcp") {
        // PAT auth check
        if (patSnapshotRef.current.hasPats) {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith("Bearer ")) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          const token = authHeader.slice(7);
          if (!validateBearerToken(token, patSnapshotRef.current)) {
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

      // Serve static files for /app/*
      if (url.startsWith("/app")) {
        const subPath = url.slice("/app".length) || "/";

        if (subPath !== "/" && extname(subPath)) {
          const filePath = resolveStaticAssetPath(webRoot, subPath);
          if (!filePath) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }

          const served = await serveStaticFile(res, filePath);
          if (served) {
            return;
          }

          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        // SPA fallback: serve index.html
        const indexPath = resolveStaticAssetPath(webRoot, "/index.html");
        const served =
          indexPath !== null
            ? await serveStaticFile(res, indexPath)
            : false;
        if (!served) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Admin UI assets are unavailable");
        }
        return;
      }

      // Everything else goes to Hono
      honoListener(req, res);
    },
  );

  // 14. Start listening
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const hostname = process.env.HOST ?? "0.0.0.0";

  server.listen(port, hostname, () => {
    ready = true;
    printStartupSummary(rt);
    process.stderr.write(
      `[meta-search] Admin: http://${hostname}:${port}/app\n`,
    );
    process.stderr.write(
      `[meta-search] Listening on http://${hostname}:${port}\n`,
    );
    process.stderr.write("[meta-search] Ready.\n");
  });

  // 15. Graceful shutdown
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

    // Close database
    try {
      closeDatabase();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[meta-search] Error closing database: ${msg}\n`);
    }

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
