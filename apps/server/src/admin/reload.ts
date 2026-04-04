import { Hono } from "hono";
import type { AdminDeps } from "./types.js";
import { applyResolvedConfig } from "../runtime-state.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createReloadRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  app.post("/", (c) => {
    try {
      applyResolvedConfig(deps);

      deps.db.insertAuditLog({
        action: "reload_config",
        target_type: "system",
        target_name: "config",
        detail: "Config reloaded successfully",
      });

      return c.json({ ok: true, message: "Config reloaded successfully" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Reload failed", details: message }, 500);
    }
  });

  return app;
}
