import process from "node:process";
import { Hono } from "hono";
import { join } from "node:path";
import { resolveConfig } from "@meta-search/config";
import { KeyPool, createKeyRevokedHandler } from "@meta-search/runtime";
import { buildPatSnapshot } from "../middleware/pat-auth.js";
import type { RuntimeState } from "../mcp/transport.js";
import type { AdminDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createReloadRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  app.post("/", (c) => {
    try {
      // 1. Re-read and validate config
      const config = resolveConfig(deps.configPath);

      // 2. Build new runtime state
      const healthOpts = {
        recoveryIntervalMs: config.key_recovery_interval_ms,
        maxDisableBeforeRevoke: config.max_disable_before_revoke,
      };

      const invalidKeysPath = join(process.cwd(), config.invalid_keys_file);
      const onKeyRevoked = createKeyRevokedHandler(invalidKeysPath);

      const newState: RuntimeState = {
        config,
        tavilyKeyPool: new KeyPool({
          providerName: "tavily",
          keys: config.tavily?.api_keys ?? [],
          strategy: config.key_rotation_strategy,
          health: healthOpts,
          onKeyRevoked,
        }),
        exaKeyPool: new KeyPool({
          providerName: "exa",
          keys: config.exa?.api_keys ?? [],
          strategy: config.key_rotation_strategy,
          health: healthOpts,
          onKeyRevoked,
        }),
        perplexityKeyPool: new KeyPool({
          providerName: "perplexity",
          keys: config.perplexity?.api_keys ?? [],
          strategy: config.key_rotation_strategy,
          health: healthOpts,
          onKeyRevoked,
        }),
        jinaKeyPool: new KeyPool({
          providerName: "jina",
          keys: config.jina?.api_keys ?? [],
          strategy: config.key_rotation_strategy,
          health: healthOpts,
          onKeyRevoked,
        }),
        cloudflareKeyPool: new KeyPool({
          providerName: "cloudflare",
          keys: buildCloudflareCredentials(config),
          strategy: config.key_rotation_strategy,
          health: healthOpts,
          onKeyRevoked,
        }),
        onKeyRevoked,
      };

      // 3. Build new PAT snapshot
      const newPatSnapshot = buildPatSnapshot(config.pats);

      // 4. Swap in-memory references
      deps.runtimeState.current = newState;
      deps.patSnapshot.current = newPatSnapshot;

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

function buildCloudflareCredentials(config: { cloudflare?: { accounts?: Array<{ account_id: string; api_token: string }> } }): unknown[] {
  if (!Array.isArray(config.cloudflare?.accounts)) return [];
  return config.cloudflare.accounts.map((a) => ({
    accountId: a.account_id,
    token: a.api_token,
  }));
}
