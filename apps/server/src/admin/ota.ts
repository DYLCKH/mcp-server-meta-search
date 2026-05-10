import { Hono } from "hono";
import { z } from "zod";
import type { AdminDeps } from "./types.js";
import {
  applyOtaUpdate,
  checkOtaUpdate,
  getOtaStatus,
  scheduleRestart,
} from "../ota.js";

const OtaUpdateSchema = z.object({
  force: z.boolean().optional(),
  restart: z.boolean().optional(),
});

export function createOtaRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    return c.json(getOtaStatus(deps.runtimeState.current.config.ota));
  });

  app.post("/check", async (c) => {
    try {
      const result = await checkOtaUpdate(deps.runtimeState.current.config.ota);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "OTA check failed", details: message }, 502);
    }
  });

  app.post("/update", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = OtaUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
    }

    const config = deps.runtimeState.current.config.ota;

    try {
      const result = await applyOtaUpdate(config, parsed.data);

      deps.db.insertAuditLog({
        action: result.updated ? "ota_update" : "ota_update_skipped",
        target_type: "system",
        target_name: "ota",
        detail: JSON.stringify({
          currentVersion: result.currentVersion,
          remoteVersion: result.remoteVersion,
          assetUrl: result.assetUrl,
          backupPath: result.backupPath,
          restartScheduled: result.restartScheduled,
        }),
      });

      if (result.updated && result.restartScheduled) {
        scheduleRestart(config, result.binaryPath);
      }

      return c.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "OTA update failed", details: message }, 500);
    }
  });

  return app;
}
