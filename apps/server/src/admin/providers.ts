import { Hono } from "hono";
import { z } from "zod";
import { mutateConfig } from "@meta-search/config";
import type { AppConfig, CloudflareAccount } from "@meta-search/config";
import {
  AUTH_ERROR_STATUSES,
  HttpProviderError,
  maskKey,
  normalizeBaseUrl,
} from "@meta-search/shared";
import {
  fetchResponseWithTimeout,
  normalizeTavilyUsageResponse,
} from "@meta-search/runtime";
import type { FetchResponse } from "@meta-search/runtime";
import type { AdminDeps, ProviderName } from "./types.js";
import { PROVIDER_NAMES, getKeyPool } from "./types.js";
import { applyResolvedConfig } from "../runtime-state.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ApiKeySchema = z.string().trim().min(1);

const CloudflareKeySchema = z.object({
  account_id: z.string().trim().min(1),
  api_token: z.string().trim().min(1),
});

const AddKeysSchema = z.object({
  api_key: ApiKeySchema.optional(),
  api_keys: z.array(ApiKeySchema).optional(),
}).superRefine((data, ctx) => {
  if (!data.api_key && (!data.api_keys || data.api_keys.length === 0)) {
    ctx.addIssue({
      code: "custom",
      message: "api_key or api_keys is required",
      path: ["api_keys"],
    });
  }
});

const AddCloudflareKeysSchema = z.object({
  api_key: CloudflareKeySchema.optional(),
  api_keys: z.array(CloudflareKeySchema).optional(),
}).superRefine((data, ctx) => {
  if (!data.api_key && (!data.api_keys || data.api_keys.length === 0)) {
    ctx.addIssue({
      code: "custom",
      message: "api_key or api_keys is required",
      path: ["api_keys"],
    });
  }
});

const UpdateKeySchema = z.object({
  disabled: z.boolean().optional(),
});

const TavilyUsageCheckSchema = z.object({
  project_id: z.string().trim().min(1).optional(),
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

function parseApiKeys(body: unknown):
  | { ok: true; keys: string[] }
  | { ok: false; issues: unknown } {
  const parsed = AddKeysSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }

  return {
    ok: true,
    keys: [
      ...(parsed.data.api_key ? [parsed.data.api_key] : []),
      ...(parsed.data.api_keys ?? []),
    ],
  };
}

function parseCloudflareKeys(body: unknown):
  | { ok: true; keys: CloudflareAccount[] }
  | { ok: false; issues: unknown } {
  const parsed = AddCloudflareKeysSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }

  return {
    ok: true,
    keys: [
      ...(parsed.data.api_key ? [parsed.data.api_key] : []),
      ...(parsed.data.api_keys ?? []),
    ],
  };
}

function extractUpstreamErrorBody(rawText: string, json: unknown): string {
  const maxLength = 500;
  const truncate = (value: string) =>
    value.length > maxLength
      ? `${value.slice(0, maxLength)}...[truncated]`
      : value;

  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.error === "string") return truncate(obj.error);
    if (
      obj.detail &&
      typeof obj.detail === "object" &&
      typeof (obj.detail as Record<string, unknown>).error === "string"
    ) {
      return truncate((obj.detail as Record<string, unknown>).error as string);
    }
    return truncate(JSON.stringify(json));
  }

  if (rawText.trim()) {
    return truncate(rawText.trim());
  }

  return "No error payload returned by provider";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getCloudflareCredential(
  key: unknown,
): { accountId: string; token: string } | null {
  const record = getRecord(key);
  if (!record) return null;

  const accountId =
    typeof record.accountId === "string"
      ? record.accountId
      : typeof record.account_id === "string"
        ? record.account_id
        : "";
  const token =
    typeof record.token === "string"
      ? record.token
      : typeof record.api_token === "string"
        ? record.api_token
        : "";

  return accountId && token ? { accountId, token } : null;
}

function buildHealthCheckRequest(
  rt: AdminDeps["runtimeState"]["current"],
  name: ProviderName,
  key: unknown,
): { url: string; init: RequestInit } | { error: string } {
  switch (name) {
    case "tavily": {
      if (typeof key !== "string") return { error: "Tavily key must be a string" };
      const baseUrl = normalizeBaseUrl(
        rt.config.tavily?.base_url,
        "https://api.tavily.com",
      );
      return {
        url: `${baseUrl}/usage`,
        init: {
          method: "GET",
          headers: {
            Authorization: `Bearer ${key}`,
          },
        },
      };
    }
    case "exa": {
      if (typeof key !== "string") return { error: "Exa key must be a string" };
      const baseUrl = normalizeBaseUrl(
        rt.config.exa?.base_url,
        "https://api.exa.ai",
      );
      return {
        url: `${baseUrl}/search`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
          },
          body: JSON.stringify({
            query: "test",
            numResults: 1,
            type: "fast",
          }),
        },
      };
    }
    case "perplexity": {
      if (typeof key !== "string") {
        return { error: "Perplexity key must be a string" };
      }
      const baseUrl = normalizeBaseUrl(
        rt.config.perplexity?.base_url,
        "https://api.perplexity.ai",
      );
      return {
        url: `${baseUrl}/search`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            query: "test",
            max_results: 1,
            max_tokens_per_page: 1,
          }),
        },
      };
    }
    case "jina": {
      if (typeof key !== "string") return { error: "Jina key must be a string" };
      const baseUrl = normalizeBaseUrl(
        rt.config.jina?.base_url,
        "https://r.jina.ai",
      );
      const timeoutSeconds = Math.max(
        1,
        Math.min(180, Math.ceil(rt.config.request_timeout_ms / 1000)),
      );
      return {
        url: `${baseUrl}/`,
        init: {
          method: "POST",
          headers: {
            Accept: "text/plain",
            "Content-Type": "application/json",
            "X-Respond-With": "markdown",
            "X-Retain-Images": "none",
            "X-Retain-Links": "text",
            "X-Cache-Tolerance": "3600",
            "X-Timeout": String(timeoutSeconds),
            DNT: "1",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ url: "https://example.com" }),
        },
      };
    }
    case "cloudflare": {
      const cred = getCloudflareCredential(key);
      if (!cred) return { error: "Cloudflare credential is invalid" };
      const baseUrl = normalizeBaseUrl(
        rt.config.cloudflare?.base_url,
        "https://api.cloudflare.com/client/v4",
      );
      return {
        url: `${baseUrl}/user/tokens/verify`,
        init: {
          method: "GET",
          headers: {
            Authorization: `Bearer ${cred.token}`,
          },
        },
      };
    }
  }
}

function cloudflareVerificationError(response: FetchResponse): string | null {
  const json = getRecord(response.json);
  if (!json) return null;

  if (json.success === false) {
    return extractUpstreamErrorBody(response.rawText, response.json);
  }

  const result = getRecord(json.result);
  const status = typeof result?.status === "string" ? result.status : null;
  if (status && status !== "active") {
    return `Cloudflare token is ${status}`;
  }

  return null;
}

function providerSemanticError(
  name: ProviderName,
  response: FetchResponse,
): string | null {
  if (name === "cloudflare") {
    return cloudflareVerificationError(response);
  }

  return null;
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

  // POST /:name/keys - add one or more keys
  app.post("/:name/keys", async (c) => {
    const name = c.req.param("name") as ProviderName;
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }

    const body = await c.req.json();
    const parsed = isCloudflare(name)
      ? parseCloudflareKeys(body)
      : parseApiKeys(body);

    if (!parsed.ok) {
      return c.json({ error: "Invalid payload", details: parsed.issues }, 400);
    }

    await mutateConfig(deps.configPath, (config) => {
      const prov = ensureProviderConfig(config, name);

      if (isCloudflare(name)) {
        const cf = prov as { accounts?: CloudflareAccount[] };
        if (!cf.accounts) cf.accounts = [];
        cf.accounts.push(...(parsed.keys as CloudflareAccount[]));
      } else {
        if (!(prov as { api_keys?: string[] }).api_keys) {
          (prov as { api_keys?: string[] }).api_keys = [];
        }
        (prov as { api_keys?: string[] }).api_keys!.push(...(parsed.keys as string[]));
      }
    });

    applyResolvedConfig(deps);
    deps.db.insertAuditLog({
      action: "add_key",
      target_type: "provider",
      target_name: name,
      detail: `count=${parsed.keys.length}`,
    });

    return c.json({ ok: true, added: parsed.keys.length }, 201);
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

  // POST /:name/keys/:index/usage - Tavily usage / quota check
  app.post("/:name/keys/:index/usage", async (c) => {
    const name = c.req.param("name") as ProviderName;
    const index = parseInt(c.req.param("index"), 10);
    if (!PROVIDER_NAMES.includes(name)) {
      return c.json({ error: `Unknown provider: ${name}` }, 400);
    }
    if (name !== "tavily") {
      return c.json({ error: "Usage checks are only supported for tavily" }, 400);
    }

    const rt = deps.runtimeState.current;
    const pool = getKeyPool(rt, name);
    if (index < 0 || index >= pool.size()) {
      return c.json({ error: "Key index out of range" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = TavilyUsageCheckSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json(
        { error: "Invalid payload", details: parsed.error.issues },
        400,
      );
    }

    const key = pool.keys[index];
    if (typeof key !== "string") {
      return c.json({ error: "Tavily key must be a string" }, 400);
    }

    const projectId = parsed.data.project_id;
    const tavilyBaseUrl = normalizeBaseUrl(
      rt.config.tavily?.base_url,
      "https://api.tavily.com",
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
    };
    if (projectId) {
      headers["X-Project-ID"] = projectId;
    }

    const response = await fetchResponseWithTimeout(
      `${tavilyBaseUrl}/usage`,
      {
        method: "GET",
        headers,
      },
      rt.config.request_timeout_ms,
    );

    if (!response.ok) {
      const error = new HttpProviderError(
        "tavily",
        response.status,
        extractUpstreamErrorBody(response.rawText, response.json),
      );

      if (AUTH_ERROR_STATUSES.has(response.status)) {
        const result = pool.disable(index);
        if (result === "revoked") {
          rt.onKeyRevoked("tavily", index, key, error);
        }
      }

      const status = AUTH_ERROR_STATUSES.has(response.status) ? 400 : 502;
      return c.json({ error: error.message, details: error.body }, status);
    }

    pool.markSuccess(index);
    deps.db.insertAuditLog({
      action: "check_usage",
      target_type: "provider",
      target_name: name,
      detail: `index=${index}`,
    });

    return c.json({
      provider: name,
      index,
      hint: maskKey(key),
      usage: normalizeTavilyUsageResponse(response.json, 1, projectId),
    });
  });

  // POST /:name/keys/:index/check - run an upstream liveness check
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

    const currentState = pool.getStatus(index);
    if (currentState.status === "revoked") {
      return c.json({ error: "Revoked keys cannot be checked" }, 400);
    }

    const key = pool.keys[index];
    const request = buildHealthCheckRequest(rt, name, key);
    if ("error" in request) {
      return c.json({ error: request.error }, 400);
    }

    const response = await fetchResponseWithTimeout(
      request.url,
      request.init,
      rt.config.request_timeout_ms,
    );
    const semanticError = response.ok
      ? providerSemanticError(name, response)
      : null;

    if (!response.ok || semanticError) {
      const status = semanticError ? 403 : response.status;
      const error = new HttpProviderError(
        name,
        status,
        semanticError ?? extractUpstreamErrorBody(response.rawText, response.json),
      );

      if (AUTH_ERROR_STATUSES.has(status)) {
        const result = pool.disable(index);
        if (result === "revoked") {
          rt.onKeyRevoked(name, index, key, error);
        }
      }

      const health = pool.getStatus(index);
      return c.json(
        {
          provider: name,
          index,
          ok: false,
          checked_at: new Date().toISOString(),
          upstream_status: status,
          health,
          error: error.message,
          details: error.body,
        },
        AUTH_ERROR_STATUSES.has(status) ? 400 : 502,
      );
    }

    pool.enable(index);
    pool.markSuccess(index);
    const checkedAt = new Date().toISOString();
    const health = pool.getStatus(index);
    deps.db.insertAuditLog({
      action: "check_key",
      target_type: "provider",
      target_name: name,
      detail: `index=${index}`,
    });

    return c.json({
      provider: name,
      index,
      ok: true,
      checked_at: checkedAt,
      upstream_status: response.status,
      health,
    });
  });

  return app;
}
