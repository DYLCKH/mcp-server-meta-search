import { Hono } from "hono";
import { z } from "zod";
import { mutateConfig } from "@meta-search/config";
import type { AppConfig, CloudflareAccount } from "@meta-search/config";
import { maskKey } from "@meta-search/shared";
import type { AdminDeps, ProviderName } from "./types.js";
import { PROVIDER_NAMES, getKeyPool } from "./types.js";
import { applyResolvedConfig } from "../runtime-state.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const AddKeySchema = z.object({
  api_key: z.string().min(1),
});

const AddCloudflareKeySchema = z.object({
  api_key: z.object({
    account_id: z.string().min(1),
    api_token: z.string().min(1),
  }),
});

const UpdateKeySchema = z.object({
  disabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProviderConfig(config: AppConfig, name: ProviderName) {
  switch (name) {
    case "tavily":
      return config.tavily;
    case "exa":
      return config.exa;
    case "perplexity":
      return config.perplexity;
    case "jina":
      return config.jina;
    case "cloudflare":
      return config.cloudflare;
  }
}

function ensureProviderConfig(config: AppConfig, name: ProviderName) {
  let prov = getProviderConfig(config, name);
  if (!prov) {
    switch (name) {
      case "tavily":
        config.tavily = {};
        prov = config.tavily;
        break;
      case "exa":
        config.exa = {};
        prov = config.exa;
        break;
      case "perplexity":
        config.perplexity = {};
        prov = config.perplexity;
        break;
      case "jina":
        config.jina = {};
        prov = config.jina;
        break;
      case "cloudflare":
        config.cloudflare = {};
        prov = config.cloudflare;
        break;
    }
  }
  return prov!;
}

function getKeysFromConfig(config: AppConfig, name: ProviderName): unknown[] {
  const prov = getProviderConfig(config, name);
  if (!prov) return [];
  if (name === "cloudflare") {
    return (prov as { accounts?: CloudflareAccount[] }).accounts ?? [];
  }
  return (prov as { api_keys?: string[] }).api_keys ?? [];
}

function isCloudflare(name: ProviderName): boolean {
  return name === "cloudflare";
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createProviderRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  // GET / - list all providers with key counts + health
  app.get("/", (c) => {
    const rt = deps.runtimeState.current;
    const result: Record<string, unknown> = {};

    for (const name of PROVIDER_NAMES) {
      const pool = getKeyPool(rt, name);
      const states = pool.getStates();
      const active = states.filter((s) => s.status === "active").length;
      const disabled = states.filter((s) => s.status === "disabled").length;
      const revoked = states.filter((s) => s.status === "revoked").length;

      result[name] = {
        total: pool.size(),
        active,
        disabled,
        revoked,
      };
    }

    return c.json({ providers: result });
  });

  // GET /:name - provider detail with per-key health
  app.get("/:name", (c) => {
    const name = c.req.param("name") as ProviderName;
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }

    const rt = deps.runtimeState.current;
    const pool = getKeyPool(rt, name);
    const states = pool.getStates();

    const keys = pool.keys.map((key, i) => ({
      index: i,
      hint: maskKey(key),
      health: states[i],
    }));

    return c.json({
      provider: name,
      total: pool.size(),
      active: pool.activeSize(),
      keys,
    });
  });

  // POST /:name/keys - add a key
  app.post("/:name/keys", async (c) => {
    const name = c.req.param("name") as ProviderName;
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }

    const body = await c.req.json();
    let parseIssues: unknown = null;

    await mutateConfig(deps.configPath, (config) => {
      const prov = ensureProviderConfig(config, name);

      if (isCloudflare(name)) {
        const parsed = AddCloudflareKeySchema.safeParse(body);
        if (!parsed.success) {
          parseIssues = parsed.error.issues;
          return;
        }
        const { account_id, api_token } = parsed.data.api_key;
        const cf = prov as { accounts?: CloudflareAccount[] };
        if (!cf.accounts) cf.accounts = [];
        cf.accounts.push({ account_id, api_token });
      } else {
        const parsed = AddKeySchema.safeParse(body);
        if (!parsed.success) {
          parseIssues = parsed.error.issues;
          return;
        }
        if (!(prov as { api_keys?: string[] }).api_keys) {
          (prov as { api_keys?: string[] }).api_keys = [];
        }
        (prov as { api_keys?: string[] }).api_keys!.push(parsed.data.api_key);
      }
    });

    if (parseIssues) {
      return c.json({ error: "Invalid payload", details: parseIssues }, 400);
    }

    applyResolvedConfig(deps);
    deps.db.insertAuditLog({
      action: "add_key",
      target_type: "provider",
      target_name: name,
      detail: null,
    });

    return c.json({ ok: true }, 201);
  });

  // PUT /:name/keys/:index - update key (disable/enable)
  app.put("/:name/keys/:index", async (c) => {
    const name = c.req.param("name") as ProviderName;
    const index = parseInt(c.req.param("index"), 10);
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }

    const rt = deps.runtimeState.current;
    const pool = getKeyPool(rt, name);
    if (index < 0 || index >= pool.size()) {
      return c.json({ error: "Key index out of range" }, 400);
    }

    const body = await c.req.json();
    const parsed = UpdateKeySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid payload", details: parsed.error.issues }, 400);
    }

    // Apply disable/enable directly on the pool's health state
    if (parsed.data.disabled === true) {
      pool.disable(index);
    } else if (parsed.data.disabled === false) {
      const enabled = pool.enable(index);
      if (!enabled) {
        return c.json({ error: "Revoked keys cannot be re-enabled" }, 400);
      }
    }

    deps.db.insertAuditLog({
      action: "update_key",
      target_type: "provider",
      target_name: name,
      detail: `index=${index} disabled=${parsed.data.disabled}`,
    });

    return c.json({ ok: true });
  });

  // DELETE /:name/keys/:index - remove key
  app.delete("/:name/keys/:index", async (c) => {
    const name = c.req.param("name") as ProviderName;
    const index = parseInt(c.req.param("index"), 10);
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }

    let outOfRange = false;
    await mutateConfig(deps.configPath, (config) => {
      const keys = getKeysFromConfig(config, name);
      if (index < 0 || index >= keys.length) {
        outOfRange = true;
        return;
      }

      if (isCloudflare(name)) {
        const cf = config.cloudflare!;
        cf.accounts?.splice(index, 1);
      } else {
        const prov = getProviderConfig(config, name) as { api_keys?: string[] };
        prov.api_keys?.splice(index, 1);
      }
    });

    if (outOfRange) {
      return c.json({ error: "Key index out of range" }, 400);
    }

    applyResolvedConfig(deps);
    deps.db.insertAuditLog({
      action: "delete_key",
      target_type: "provider",
      target_name: name,
      detail: `index=${index}`,
    });

    return c.json({ ok: true });
  });

  // POST /:name/keys/:index/check - manual health check trigger
  app.post("/:name/keys/:index/check", async (c) => {
    const name = c.req.param("name") as ProviderName;
    const index = parseInt(c.req.param("index"), 10);
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }

    const rt = deps.runtimeState.current;
    const pool = getKeyPool(rt, name);
    if (index < 0 || index >= pool.size()) {
      return c.json({ error: "Key index out of range" }, 400);
    }

    // Return current health state (actual health checking is done
    // during request processing; this endpoint reports current status)
    const state = pool.getStatus(index);
    return c.json({
      provider: name,
      index,
      health: state,
    });
  });

  return app;
}
