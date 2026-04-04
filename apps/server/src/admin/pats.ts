import { Hono } from "hono";
import { z } from "zod";
import { writeConfigAtomic, loadConfig, AppConfigSchema } from "@meta-search/config";
import { generatePat } from "@meta-search/runtime";
import type { AdminDeps } from "./types.js";
import { applyResolvedConfig } from "../runtime-state.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreatePatSchema = z.object({
  name: z.string().min(1).max(128),
  note: z.string().max(512).optional(),
  expires_at: z.string().datetime({ offset: true }).optional().nullable(),
});

const UpdatePatSchema = z.object({
  disabled: z.boolean().optional(),
  note: z.string().max(512).optional(),
  expires_at: z.string().datetime({ offset: true }).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createPatRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  // GET / - list PATs (masked)
  app.get("/", (c) => {
    const config = loadConfig(deps.configPath);
    const pats = config.pats ?? [];

    return c.json({
      pats: pats.map((p) => ({
        name: p.name,
        prefix: p.prefix,
        disabled: p.disabled ?? false,
        note: p.note ?? null,
        expires_at: p.expires_at ?? null,
        created_at: p.created_at ?? null,
      })),
    });
  });

  // POST / - create PAT, return full token
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreatePatSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
    }

    const { name, note, expires_at } = parsed.data;
    const config = loadConfig(deps.configPath);

    if (!config.pats) config.pats = [];

    // Check for duplicate name
    if (config.pats.some((p) => p.name === name)) {
      return c.json({ error: `PAT with name "${name}" already exists` }, 409);
    }

    const { token, prefix, hash } = generatePat();

    config.pats.push({
      name,
      prefix,
      hash,
      encrypted: false,
      disabled: false,
      note: note ?? null,
      expires_at: expires_at ?? null,
      created_at: new Date().toISOString(),
      last_used_at: null,
    });

    writeConfigAtomic(deps.configPath, AppConfigSchema.parse(config));
    applyResolvedConfig(deps);

    deps.db.insertAuditLog({
      action: "create_pat",
      target_type: "pat",
      target_name: name,
      detail: null,
    });

    return c.json({ ok: true, name, token, prefix }, 201);
  });

  // GET /:name - PAT detail
  app.get("/:name", (c) => {
    const name = c.req.param("name");
    const config = loadConfig(deps.configPath);
    const pat = config.pats?.find((p) => p.name === name);

    if (!pat) {
      return c.json({ error: `PAT "${name}" not found` }, 404);
    }

    return c.json({
      name: pat.name,
      prefix: pat.prefix,
      disabled: pat.disabled ?? false,
      note: pat.note ?? null,
      expires_at: pat.expires_at ?? null,
      created_at: pat.created_at ?? null,
      last_used_at: pat.last_used_at ?? null,
    });
  });

  // POST /:name/reveal - reveal full token (with audit)
  app.post("/:name/reveal", async (c) => {
    const name = c.req.param("name");

    deps.db.insertAuditLog({
      action: "reveal_pat",
      target_type: "pat",
      target_name: name,
      detail: "Token revealed via admin API",
    });

    // The full token is not recoverable from the stored hash.
    // This endpoint confirms the reveal action was logged.
    return c.json({
      name,
      message:
        "Full token was only available at creation time. Reveal action has been logged.",
    });
  });

  // PUT /:name - update PAT
  app.put("/:name", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json();
    const parsed = UpdatePatSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
    }

    const config = loadConfig(deps.configPath);
    const pat = config.pats?.find((p) => p.name === name);

    if (!pat) {
      return c.json({ error: `PAT "${name}" not found` }, 404);
    }

    if (parsed.data.disabled !== undefined) pat.disabled = parsed.data.disabled;
    if (parsed.data.note !== undefined) pat.note = parsed.data.note;
    if (parsed.data.expires_at !== undefined) pat.expires_at = parsed.data.expires_at;

    writeConfigAtomic(deps.configPath, AppConfigSchema.parse(config));
    applyResolvedConfig(deps);

    deps.db.insertAuditLog({
      action: "update_pat",
      target_type: "pat",
      target_name: name,
      detail: JSON.stringify(parsed.data),
    });

    return c.json({ ok: true });
  });

  // DELETE /:name - delete PAT
  app.delete("/:name", (c) => {
    const name = c.req.param("name");
    const config = loadConfig(deps.configPath);

    if (!config.pats) {
      return c.json({ error: `PAT "${name}" not found` }, 404);
    }

    const index = config.pats.findIndex((p) => p.name === name);
    if (index === -1) {
      return c.json({ error: `PAT "${name}" not found` }, 404);
    }

    config.pats.splice(index, 1);
    if (config.pats.length === 0) {
      delete config.pats;
    }

    writeConfigAtomic(deps.configPath, AppConfigSchema.parse(config));
    applyResolvedConfig(deps);

    deps.db.insertAuditLog({
      action: "delete_pat",
      target_type: "pat",
      target_name: name,
      detail: null,
    });

    return c.json({ ok: true });
  });

  return app;
}
