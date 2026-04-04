import { dirname } from "node:path";
import { resolveConfig } from "@meta-search/config";
import type { ResolvedConfig } from "@meta-search/config";
import { KeyPool, createKeyRevokedHandler, createPerfInstances } from "@meta-search/runtime";
import { buildPatSnapshot } from "./middleware/pat-auth.js";
import type { AdminDeps } from "./admin/types.js";
import type { RuntimeState } from "./mcp/transport.js";
import { resolveAppPath } from "./path-utils.js";

type RevokedHandler = RuntimeState["onKeyRevoked"];

function buildCloudflareCredentials(config: ResolvedConfig): unknown[] {
  if (!Array.isArray(config.cloudflare?.accounts)) return [];
  return config.cloudflare.accounts.map((account) => ({
    accountId: account.account_id,
    token: account.api_token,
  }));
}

function createProviderKeyPool(
  config: ResolvedConfig,
  providerName: string,
  keys: unknown[],
  onKeyRevoked: RevokedHandler,
): KeyPool {
  return new KeyPool({
    providerName,
    keys,
    strategy: config.key_rotation_strategy,
    health: {
      recoveryIntervalMs: config.key_recovery_interval_ms,
      maxDisableBeforeRevoke: config.max_disable_before_revoke,
    },
    onKeyRevoked,
  });
}

export function buildRuntimeState(
  config: ResolvedConfig,
  configDir: string,
): RuntimeState {
  const invalidKeysPath = resolveAppPath(config.invalid_keys_file, configDir);
  const onKeyRevoked = createKeyRevokedHandler(invalidKeysPath);
  // Concurrency limiting has no separate enable switch, so the perf container
  // must always exist even when cache/circuit/single-flight are disabled.
  const perf = createPerfInstances(config.performance);

  return {
    config,
    perf,
    tavilyKeyPool: createProviderKeyPool(
      config,
      "tavily",
      config.tavily?.api_keys ?? [],
      onKeyRevoked,
    ),
    exaKeyPool: createProviderKeyPool(
      config,
      "exa",
      config.exa?.api_keys ?? [],
      onKeyRevoked,
    ),
    perplexityKeyPool: createProviderKeyPool(
      config,
      "perplexity",
      config.perplexity?.api_keys ?? [],
      onKeyRevoked,
    ),
    jinaKeyPool: createProviderKeyPool(
      config,
      "jina",
      config.jina?.api_keys ?? [],
      onKeyRevoked,
    ),
    cloudflareKeyPool: createProviderKeyPool(
      config,
      "cloudflare",
      buildCloudflareCredentials(config),
      onKeyRevoked,
    ),
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
