import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "@meta-search/config";
import { KeyPool } from "@meta-search/runtime";
import {
  createTavilyCrawlToolHandler,
  createTavilyToolHandler,
  createTavilyUsageToolHandler,
  type RuntimeState,
  type RuntimeStateRefLike,
} from "./transport.js";

function createConfig(baseUrl: string, apiKey: string): ResolvedConfig {
  return {
    server: {
      host: "0.0.0.0",
      port: 3000,
    },
    tavily: {
      base_url: baseUrl,
      api_keys: [apiKey],
    },
    exa: undefined,
    perplexity: undefined,
    jina: undefined,
    cloudflare: undefined,
    pats: [],
    admin: undefined,
    key_rotation_strategy: "round_robin",
    max_attempts_per_request: 1,
    request_timeout_ms: 1_000,
    key_recovery_interval_ms: 300_000,
    max_disable_before_revoke: 3,
    invalid_keys_file: "invalid-keys.json",
    performance: {
      cache: {
        enabled: false,
        maxSize: 16,
        defaultTtlMs: 1_000,
      },
      concurrency: {
        maxConcurrency: 2,
        maxQueueSize: 4,
        queueTimeoutMs: 1_000,
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
    ota: {
      enabled: false,
      repository: "DYLCKH/mcp-server-meta-search",
      tag: "dev",
      request_timeout_ms: 60_000,
      restart_delay_ms: 500,
      restart_strategy: "self",
    },
  };
}

function createRuntimeState(baseUrl: string, apiKey: string): RuntimeState {
  return {
    config: createConfig(baseUrl, apiKey),
    perf: undefined,
    tavilyKeyPool: new KeyPool({
      providerName: "tavily",
      keys: [apiKey],
    }),
    exaKeyPool: new KeyPool({
      providerName: "exa",
      keys: [],
    }),
    perplexityKeyPool: new KeyPool({
      providerName: "perplexity",
      keys: [],
    }),
    jinaKeyPool: new KeyPool({
      providerName: "jina",
      keys: [],
    }),
    cloudflareKeyPool: new KeyPool({
      providerName: "cloudflare",
      keys: [],
    }),
    onKeyRevoked: vi.fn(),
  };
}

describe("createTavilyToolHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the latest runtime state on each invocation", async () => {
    const runtimeStateRef: RuntimeStateRefLike = {
      current: createRuntimeState("https://old.example", "old-key"),
    };
    const handler = createTavilyToolHandler(runtimeStateRef);

    runtimeStateRef.current = createRuntimeState(
      "https://new.example",
      "new-key",
    );

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://new.example/search");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer new-key",
      });

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            query: "latest",
            results: [],
          }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await handler({
      query: "latest",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      provider: "tavily",
      query: "latest",
    });
  });

  it("preserves Tavily response_time when upstream returns a string", async () => {
    const runtimeStateRef: RuntimeStateRefLike = {
      current: createRuntimeState("https://tavily.example", "test-key"),
    };
    const handler = createTavilyToolHandler(runtimeStateRef);

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          query: "latency",
          response_time: "1.67",
          results: [],
        }),
    }));

    const result = await handler({
      query: "latency",
    });

    expect(result.structuredContent).toMatchObject({
      provider: "tavily",
      query: "latency",
      response_time: "1.67",
    });
  });
});

describe("createTavilyCrawlToolHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the latest runtime state and posts to /crawl", async () => {
    const runtimeStateRef: RuntimeStateRefLike = {
      current: createRuntimeState("https://old.example", "old-key"),
    };
    const handler = createTavilyCrawlToolHandler(runtimeStateRef);

    runtimeStateRef.current = createRuntimeState(
      "https://new.example",
      "new-key",
    );

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://new.example/crawl");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer new-key",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        url: "https://docs.tavily.com",
        max_depth: 2,
      });

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            base_url: "https://docs.tavily.com",
            results: [],
          }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await handler({
      url: "https://docs.tavily.com",
      max_depth: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      provider: "tavily_crawl",
      base_url: "https://docs.tavily.com",
    });
  });
});

describe("createTavilyUsageToolHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads latest runtime state and gets /usage", async () => {
    const runtimeStateRef: RuntimeStateRefLike = {
      current: createRuntimeState("https://old.example", "old-key"),
    };
    const handler = createTavilyUsageToolHandler(runtimeStateRef);

    runtimeStateRef.current = createRuntimeState(
      "https://new.example",
      "new-key",
    );

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://new.example/usage");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer new-key",
        "X-Project-ID": "project-123",
      });

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            key: {
              usage: 4,
              limit: 10,
            },
            account: {
              plan_usage: 40,
              plan_limit: 100,
            },
          }),
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await handler({
      project_id: "project-123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({
      provider: "tavily_usage",
      project_id: "project-123",
      key: {
        usage: 4,
        limit: 10,
        remaining: 6,
      },
      account: {
        plan_usage: 40,
        plan_limit: 100,
        plan_remaining: 60,
      },
    });
  });
});
