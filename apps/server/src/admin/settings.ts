import { Hono } from "hono";
import { z } from "zod";
import { writeConfigAtomic, loadConfig, AppConfigSchema } from "@meta-search/config";
import type { AdminDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const SettingsUpdateSchema = z.object({
  key_rotation_strategy: z.enum(["round_robin", "random"]).optional(),
  max_attempts_per_request: z.number().int().min(0).max(100).optional(),
  request_timeout_ms: z.number().int().min(1000).max(300_000).optional(),
  key_recovery_interval_ms: z.number().int().min(0).max(86_400_000).optional(),
  max_disable_before_revoke: z.number().int().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createSettingsRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  // GET / - current settings
  app.get("/", (c) => {
    const { config } = deps.runtimeState.current;
    return c.json({
      key_rotation_strategy: config.key_rotation_strategy,
      max_attempts_per_request: config.max_attempts_per_request,
      request_timeout_ms: config.request_timeout_ms,
      key_recovery_interval_ms: config.key_recovery_interval_ms,
      max_disable_before_revoke: config.max_disable_before_revoke,
    });
  });

  // PUT / - update settings, trigger hot reload
  app.put("/", async (c) => {
    const body = await c.req.json();
    const parsed = SettingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
    }

    const config = loadConfig(deps.configPath);

    // Apply updates to config
    if (parsed.data.key_rotation_strategy !== undefined) {
      config.key_rotation_strategy = parsed.data.key_rotation_strategy;
    }
    if (parsed.data.max_attempts_per_request !== undefined) {
      config.max_attempts_per_request = parsed.data.max_attempts_per_request;
    }
    if (parsed.data.request_timeout_ms !== undefined) {
      config.request_timeout_ms = parsed.data.request_timeout_ms;
    }
    if (parsed.data.key_recovery_interval_ms !== undefined) {
      config.key_recovery_interval_ms = parsed.data.key_recovery_interval_ms;
    }
    if (parsed.data.max_disable_before_revoke !== undefined) {
      config.max_disable_before_revoke = parsed.data.max_disable_before_revoke;
    }

    // Re-validate the full config
    const validated = AppConfigSchema.parse(config);

    writeConfigAtomic(deps.configPath, validated);

    deps.db.insertAuditLog({
      action: "update_settings",
      target_type: "settings",
      target_name: "global",
      detail: JSON.stringify(parsed.data),
    });

    return c.json({ ok: true });
  });

  return app;
}
