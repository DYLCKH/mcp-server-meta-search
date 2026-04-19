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
  createTavilyHandler,
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
