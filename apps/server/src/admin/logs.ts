import { Hono } from "hono";
import type { AdminDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createLogRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  // GET /requests - request logs
  app.get("/requests", (c) => {
    const filters = {
      tool: c.req.query("tool"),
      provider: c.req.query("provider"),
      status: c.req.query("status"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      limit: Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10), 1), 1000),
      offset: Math.max(parseInt(c.req.query("offset") ?? "0", 10), 0),
    };

    const logs = deps.db.queryRequestLogs(filters);
    return c.json({ logs, limit: filters.limit, offset: filters.offset });
  });

  // GET /audit - audit logs
  app.get("/audit", (c) => {
    const filters = {
      action: c.req.query("action"),
      target_type: c.req.query("target_type"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      limit: Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10), 1), 1000),
      offset: Math.max(parseInt(c.req.query("offset") ?? "0", 10), 0),
    };

    const logs = deps.db.queryAuditLogs(filters);
    return c.json({ logs, limit: filters.limit, offset: filters.offset });
  });

  return app;
}
