import { Hono } from "hono";
import type { AdminDeps, ProviderName } from "./types.js";
import { PROVIDER_NAMES, getKeyPool } from "./types.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createDashboardRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rt = deps.runtimeState.current;
    const config = rt.config;

    const providers: Record<string, unknown> = {};

    for (const name of PROVIDER_NAMES) {
      const pool = getKeyPool(rt, name);
      const states = pool.getStates();

      providers[name] = {
        total: pool.size(),
        active: states.filter((s) => s.status === "active").length,
        disabled: states.filter((s) => s.status === "disabled").length,
        revoked: states.filter((s) => s.status === "revoked").length,
      };
    }

    const patCount = config.pats?.length ?? 0;

    return c.json({
      providers,
      pat_count: patCount,
    });
  });

  return app;
}
