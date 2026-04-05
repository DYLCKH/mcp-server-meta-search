import { afterEach, describe, expect, it, vi } from "vitest";
import { callWithPerf } from "./http-client.js";
import { KeyPool } from "./key-pool.js";
import { ResultCache } from "./perf/cache.js";
import { CircuitBreaker } from "./perf/circuit-breaker.js";
import { createPerfInstances } from "./index.js";

describe("callWithPerf", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns cached results even when the circuit breaker is open", async () => {
    const cache = new ResultCache({
      maxSize: 4,
      defaultTtlMs: 1_000,
    });
    const breaker = new CircuitBreaker("tavily", {
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
      halfOpenMaxRequests: 1,
    });
    const cachedResult = {
      data: { cached: true },
      attempts: 1,
    };

    cache.set("tavily:search:test", cachedResult);
    await expect(
      breaker.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callWithPerf({
      providerName: "tavily",
      keyPool: new KeyPool({
        providerName: "tavily",
        keys: [],
      }),
      timeoutMs: 1_000,
      configuredMaxAttempts: 1,
      cacheKey: "tavily:search:test",
      perf: {
        cache,
        circuitBreaker: breaker,
      },
      buildRequest: () => {
        throw new Error("should not build request when cache hits");
      },
    });

    expect(result).toEqual(cachedResult);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(breaker.state).toBe("open");
  });
});

describe("createPerfInstances", () => {
  it("creates isolated circuit breakers per provider", async () => {
    const perf = createPerfInstances({
      cache: {
        enabled: true,
        maxSize: 16,
        defaultTtlMs: 1_000,
      },
      concurrency: {
        maxConcurrency: 2,
        maxQueueSize: 4,
        queueTimeoutMs: 1_000,
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
      },
      singleFlight: {
        enabled: true,
      },
    });

    const tavilyBreaker = perf.getCircuitBreaker("tavily");
    const exaBreaker = perf.getCircuitBreaker("exa");

    await expect(
      tavilyBreaker.execute(async () => {
        throw new Error("tavily failure");
      }),
    ).rejects.toThrow("tavily failure");

    expect(tavilyBreaker).toBe(perf.getCircuitBreaker("tavily"));
    expect(tavilyBreaker.state).toBe("open");
    expect(exaBreaker.state).toBe("closed");
  });
});
