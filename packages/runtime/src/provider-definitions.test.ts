import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { KeyPool } from "./key-pool.js";
import {
  TOOL_DEFINITION as CLOUDFLARE_TOOL_DEFINITION,
} from "./providers/cloudflare.js";
import {
  TOOL_DEFINITION as EXA_TOOL_DEFINITION,
} from "./providers/exa.js";
import {
  TOOL_DEFINITION as PERPLEXITY_TOOL_DEFINITION,
} from "./providers/perplexity.js";
import {
  CRAWL_TOOL_DEFINITION as TAVILY_CRAWL_TOOL_DEFINITION,
  USAGE_TOOL_DEFINITION as TAVILY_USAGE_TOOL_DEFINITION,
  createTavilyCrawlHandler,
  createTavilyHandler,
  createTavilyUsageHandler,
} from "./providers/tavily.js";

function objectSchema(shape: Record<string, z.ZodTypeAny>) {
  return z.object(shape);
}

describe("provider tool definitions", () => {
  it("accepts the current Exa search type values and rejects retired categories", () => {
    const schema = objectSchema(EXA_TOOL_DEFINITION.inputSchema);

    expect(
      schema.safeParse({ query: "llm", type: "deep-reasoning" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: "llm", type: "deep-lite" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: "llm", category: "tweet" }).success,
    ).toBe(false);
  });

  it("matches the current Perplexity token limits", () => {
    const schema = objectSchema(PERPLEXITY_TOOL_DEFINITION.inputSchema);

    expect(
      schema.safeParse({ query: "search", max_tokens_per_page: 4096 }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: "search", max_tokens_per_page: 1_000_000 })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: "search", max_tokens_per_page: 1_000_001 })
        .success,
    ).toBe(false);
  });

  it("matches the current Cloudflare selector timeout limit", () => {
    expect(
      CLOUDFLARE_TOOL_DEFINITION.inputSchema.safeParse({
        url: "https://example.com",
        waitForSelector: {
          selector: "main",
          timeout: 120000,
        },
      }).success,
    ).toBe(true);
    expect(
      CLOUDFLARE_TOOL_DEFINITION.inputSchema.safeParse({
        url: "https://example.com",
        waitForSelector: {
          selector: "main",
          timeout: 120001,
        },
      }).success,
    ).toBe(false);
  });

  it("matches the current Tavily crawl limits", () => {
    const schema = objectSchema(TAVILY_CRAWL_TOOL_DEFINITION.inputSchema);

    expect(
      schema.safeParse({
        url: "https://docs.tavily.com",
        max_depth: 5,
        max_breadth: 500,
        chunks_per_source: 5,
        timeout: 150,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        url: "https://docs.tavily.com",
        max_depth: 6,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        url: "https://docs.tavily.com",
        timeout: 151,
      }).success,
    ).toBe(false);
  });

  it("accepts optional Tavily usage project IDs", () => {
    const schema = objectSchema(TAVILY_USAGE_TOOL_DEFINITION.inputSchema);

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ project_id: "project-123" }).success).toBe(true);
    expect(schema.safeParse({ project_id: "" }).success).toBe(false);
  });
});

describe("createTavilyHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves Tavily response_time when upstream returns a string", async () => {
    const handler = createTavilyHandler({
      baseUrl: "https://api.tavily.com",
      keyPool: new KeyPool({
        providerName: "tavily",
        keys: ["tvly-test"],
      }),
      timeoutMs: 1_000,
      maxAttempts: 1,
      onKeyRevoked: vi.fn(),
    });

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

describe("createTavilyCrawlHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts crawl requests to Tavily and normalizes results", async () => {
    const handler = createTavilyCrawlHandler({
      baseUrl: "https://api.tavily.com",
      keyPool: new KeyPool({
        providerName: "tavily",
        keys: ["tvly-test"],
      }),
      timeoutMs: 1_000,
      maxAttempts: 1,
      onKeyRevoked: vi.fn(),
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.tavily.com/crawl");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer tvly-test",
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
            response_time: "2.1",
            results: [{ url: "https://docs.tavily.com/docs" }],
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
      response_time: "2.1",
      results: [{ url: "https://docs.tavily.com/docs" }],
    });
  });
});

describe("createTavilyUsageHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gets Tavily usage and calculates remaining quota", async () => {
    const handler = createTavilyUsageHandler({
      baseUrl: "https://api.tavily.com",
      keyPool: new KeyPool({
        providerName: "tavily",
        keys: ["tvly-test"],
      }),
      timeoutMs: 1_000,
      maxAttempts: 1,
      onKeyRevoked: vi.fn(),
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.tavily.com/usage");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer tvly-test",
        "X-Project-ID": "project-123",
      });

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            key: {
              usage: 25,
              limit: 100,
            },
            account: {
              plan_usage: 300,
              plan_limit: 1_000,
              paygo_usage: 5,
              paygo_limit: 50,
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
        usage: 25,
        limit: 100,
        remaining: 75,
      },
      account: {
        plan_usage: 300,
        plan_limit: 1_000,
        plan_remaining: 700,
        paygo_usage: 5,
        paygo_limit: 50,
        paygo_remaining: 45,
      },
    });
  });
});
