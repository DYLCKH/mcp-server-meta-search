import { dirname } from "node:path";
import { resolveConfig } from "@meta-search/config";
import type { ResolvedConfig } from "@meta-search/config";
import { KeyPool, createKeyRevokedHandler, createPerfInstances } from "@meta-search/runtime";
import { buildPatSnapshot } from "./middleware/pat-auth.js";
import type { AdminDeps } from "./admin/types.js";
import type { RuntimeState } from "./mcp/transport.js";
import { resolveAppPath } from "./path-utils.js";

function buildCloudflareCredentials(config: ResolvedConfig): unknown[] {
  if (!Array.isArray(config.cloudflare?.accounts)) return [];
  return config.cloudflare.accounts.map((account) => ({
    accountId: account.account_id,
    token: account.api_token,
  }));
}

export function buildRuntimeState(
  config: ResolvedConfig,
  configDir: string,
): RuntimeState {
  const healthOpts = {
    recoveryIntervalMs: config.key_recovery_interval_ms,
    maxDisableBeforeRevoke: config.max_disable_before_revoke,
  };

  const invalidKeysPath = resolveAppPath(config.invalid_keys_file, configDir);
  const onKeyRevoked = createKeyRevokedHandler(invalidKeysPath);
  const perfConfig = config.performance;
  const perf =
    perfConfig.cache.enabled ||
    perfConfig.circuitBreaker.enabled ||
    perfConfig.singleFlight.enabled
      ? createPerfInstances(perfConfig)
      : undefined;

  return {
    config,
    perf,
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
}

export function applyResolvedConfig(
  deps: AdminDeps,
  config = resolveConfig(deps.configPath),
): ResolvedConfig {
  deps.runtimeState.current = buildRuntimeState(config, dirname(deps.configPath));
  deps.patSnapshot.current = buildPatSnapshot(config.pats);
  return config;
}
