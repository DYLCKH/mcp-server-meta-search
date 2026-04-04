import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "@meta-search/config";
import { buildRuntimeState } from "./runtime-state.js";

function createConfig(): ResolvedConfig {
  return {
    tavily: undefined,
    exa: undefined,
    perplexity: undefined,
    jina: undefined,
    cloudflare: undefined,
    pats: [],
    admin: undefined,
    key_rotation_strategy: "round_robin",
    max_attempts_per_request: 0,
    request_timeout_ms: 30_000,
    key_recovery_interval_ms: 300_000,
    max_disable_before_revoke: 3,
    invalid_keys_file: "invalid-keys.json",
    performance: {
      cache: {
        enabled: false,
        maxSize: 512,
        defaultTtlMs: 60_000,
      },
      concurrency: {
        maxConcurrency: 1,
        maxQueueSize: 8,
        queueTimeoutMs: 30_000,
      },
      circuitBreaker: {
        enabled: false,
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
      },
      singleFlight: {
        enabled: false,
      },
    },
  };
}

describe("buildRuntimeState", () => {
  it("keeps perf instances available for concurrency limiting", async () => {
    const runtimeState = buildRuntimeState(createConfig(), "/tmp/meta-search");

    expect(runtimeState.perf).toBeDefined();

    const release = await runtimeState.perf!.limiter.acquire();
    expect(runtimeState.perf!.limiter.stats.active).toBe(1);

    release();

    expect(runtimeState.perf!.limiter.stats.active).toBe(0);
  });
});
