import process from "node:process";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { resolveConfig } from "@meta-search/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildPatSnapshot, validateBearerToken } from "./middleware/pat-auth.js";
import type { PatSnapshot } from "./middleware/pat-auth.js";
import {
  createMcpServer,
  createTransport,
  mcpCallContext,
  setMcpLogger,
} from "./mcp/transport.js";
import type { RuntimeState } from "./mcp/transport.js";
import {
  initDatabase,
  closeDatabase,
  logAuditEvent,
  logMcpRequest,
  queryRequestLogs,
  queryAuditLogs,
} from "./db/index.js";
import type {
  RequestLogFilters as DbRequestLogFilters,
  AuditLogFilters as DbAuditLogFilters,
} from "./db/index.js";
import { createAdminRouter } from "./admin/router.js";
import { requireAdminAuth } from "./admin/auth.js";
import type { AdminDeps, DbHandle } from "./admin/types.js";
import { bootstrapAdminPassword } from "./admin/bootstrap.js";
import { resolveAppPath, resolveStaticAssetPath } from "./path-utils.js";
import { buildRuntimeState } from "./runtime-state.js";
import { getEmbeddedAsset } from "./static-assets.js";
import { ensureConfigFile } from "./config-bootstrap.js";

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
const IS_COMPILED = !SERVER_MODULE_DIR.includes("apps/server");
const WORKSPACE_ROOT = process.env.META_SEARCH_ROOT
  ?? (IS_COMPILED ? process.cwd() : resolve(SERVER_MODULE_DIR, "..", "..", ".."));

// Cap MCP POST bodies to avoid OOM under malicious or runaway clients.
const MCP_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

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

async function serveEmbeddedAsset(assetPath: string): Promise<Response | null> {
  const asset = await getEmbeddedAsset(assetPath);
  if (!asset) return null;
  return new Response(asset.data, {
    headers: { "Content-Type": asset.contentType },
  });
}

async function serveStaticFile(filePath: string): Promise<Response | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  return new Response(file, {
    headers: { "Content-Type": contentType },
  });
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
    if (pc.cache.enabled) {
      parts.push(
        `cache(max=${pc.cache.maxSize},bytes=${formatBytes(pc.cache.maxBytes)},entry=${formatBytes(pc.cache.maxEntryBytes)},ttl=${pc.cache.defaultTtlMs}ms)`,
      );
    }
    if (pc.circuitBreaker.enabled) parts.push(`cb(threshold=${pc.circuitBreaker.failureThreshold})`);
    if (pc.singleFlight.enabled) parts.push("single-flight");
    parts.push(`concurrency(${pc.concurrency.maxConcurrency})`);
    if (parts.length > 0) {
      process.stderr.write(`[meta-search]   Perf: ${parts.join(", ")}\n`);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)}MiB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KiB`;
  }
  return `${bytes}B`;
}

function resolveListenPort(envPort: string | undefined, configPort: number): number {
  if (envPort === undefined) {
    return configPort;
  }

  const port = Number.parseInt(envPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value "${envPort}". Expected an integer from 1 to 65535.`);
  }

  return port;
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
  const createdConfig = await ensureConfigFile(configPath, {
    workspaceRoot: WORKSPACE_ROOT,
    preferBundledExample: IS_COMPILED,
  });
  if (createdConfig) {
    process.stderr.write(
      `[meta-search] Config not found. Created ${configPath} from bundled config.jsonc.example.\n`,
    );
    process.stderr.write(
      "[meta-search] Edit the config file with your API keys and restart the server.\n",
    );
    return;
  }

  // 2a. Hash any plaintext admin.password in config and persist back to disk
  //     before we resolve the config into runtime state.
  await bootstrapAdminPassword(configPath);

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
  setMcpLogger(logMcpRequest);
  const dbHandle = createDbHandle();

  // 6. Create mutable refs for runtime snapshots
  const runtimeStateRef: { current: RuntimeState } = { current: rt };
  const patSnapshotRef: { current: PatSnapshot } = { current: patSnapshot };

  // 7. Initialize MCP server and transport
  const mcpServer = createMcpServer(runtimeStateRef);
  const transport = createTransport();
  await mcpServer.connect(transport);

  // 8. Track readiness
  let ready = false;

  // 9. Create admin router
  const adminDeps: AdminDeps = {
    configPath,
    runtimeState: runtimeStateRef,
    patSnapshot: patSnapshotRef,
    db: dbHandle,
  };
  const adminRouter = createAdminRouter(adminDeps);

  // 10. Determine WebUI static root
  const webRoot = join(WORKSPACE_ROOT, "apps", "web", "dist");

  // 11. Create Hono app with all routes
  const app = new Hono();

  app.get("/healthz", (c) => c.text("OK"));

  app.get("/readyz", (c) => {
    if (ready) {
      return c.text("OK");
    }
    return c.text("Not ready", 503);
  });

  app.use("/metrics", requireAdminAuth(adminDeps));
  app.get("/metrics", (c) => {
    const metrics = runtimeStateRef.current.perf?.metrics;
    if (!metrics) {
      return c.text("", 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    }
    const text = metrics.getPrometheusMetrics();
    return c.text(text, 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  });

  // MCP transport (web-standard Request/Response)
  app.all("/mcp", async (c) => {
    // Body size guard — reject oversized requests before touching transport.
    const contentLengthHeader = c.req.header("content-length");
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > MCP_MAX_BODY_BYTES) {
        return c.json({ error: "Payload too large" }, 413);
      }
    }

    let patName: string | null = null;
    if (patSnapshotRef.current.hasPats) {
      const authHeader = c.req.header("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const token = authHeader.slice(7);
      const result = validateBearerToken(token, patSnapshotRef.current);
      if (!result.valid) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      patName = result.patName;
    }

    try {
      return await mcpCallContext.run({ patName }, () =>
        transport.handleRequest(c.req.raw),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[meta-search] MCP transport error: ${msg}\n`);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // Mount admin API routes
  app.route("/api/admin", adminRouter);

  // Static file serving for /app
  const serveAppAssets = async (c: { req: { path: string } }) => {
    const subPath = c.req.path.slice("/app".length) || "/";

    if (subPath !== "/" && extname(subPath)) {
      const embedded = await serveEmbeddedAsset(subPath);
      if (embedded) return embedded;

      const filePath = resolveStaticAssetPath(webRoot, subPath);
      if (filePath) {
        const response = await serveStaticFile(filePath);
        if (response) return response;
      }
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // SPA fallback: serve index.html
    const embedded = await serveEmbeddedAsset("/index.html");
    if (embedded) return embedded;

    const indexPath = resolveStaticAssetPath(webRoot, "/index.html");
    if (indexPath) {
      const response = await serveStaticFile(indexPath);
      if (response) return response;
    }
    return new Response("Admin UI assets are unavailable", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };

  app.get("/app", serveAppAssets);
  app.get("/app/*", serveAppAssets);

  // 12. Start listening
  const port = resolveListenPort(process.env.PORT, config.server.port);
  const hostname = process.env.HOST ?? config.server.host;

  const server = Bun.serve({
    port,
    hostname,
    fetch: app.fetch,
  });

  ready = true;
  printStartupSummary(rt);
  process.stderr.write(
    `[meta-search] Admin: http://${hostname}:${port}/app\n`,
  );
  process.stderr.write(
    `[meta-search] Listening on http://${hostname}:${port}\n`,
  );
  process.stderr.write("[meta-search] Ready.\n");

  // 13. Graceful shutdown
  setupGracefulShutdown(server, mcpServer);
}

function setupGracefulShutdown(
  server: { stop(closeActiveConnections?: boolean): void },
  mcpServer: McpServer,
): void {
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    process.stderr.write("[meta-search] Shutting down...\n");

    try {
      closeDatabase();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[meta-search] Error closing database: ${msg}\n`);
    }

    server.stop();
    process.stderr.write("[meta-search] HTTP server closed.\n");

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
