import { z } from "zod";
import { compactObject, optionalIntSchema } from "@meta-search/shared";
import type { KeyPool } from "../key-pool.js";
import { callWithKeyRotation } from "../http-client.js";

export const TOOL_NAME = "search_perplexity";

export const TOOL_DEFINITION = {
  title: "Perplexity Search (Key Rotation)",
  description:
    "Perform web search via Perplexity. Best for AI-synthesized answers with inline citations and high factuality.",
  inputSchema: {
    query: z.string().min(1).describe("The search query to execute with Perplexity."),
    max_results: optionalIntSchema(z.number().int().min(1).max(20)).describe("The maximum number of search results to return (1-20, default 10)."),
    max_tokens_per_page: optionalIntSchema(z.number().int().min(1).max(1_000_000)).describe("Maximum tokens of content to return per result page (1-1000000, default 4096)."),
    country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code to bias search results, e.g. US, CN, GB."),
  },
  annotations: {
    readOnlyHint: true,
  },
} as const;

export interface PerplexityHandlerDeps {
  baseUrl: string;
  keyPool: KeyPool;
  timeoutMs: number;
  maxAttempts: number;
  onKeyRevoked: (providerName: string, index: number, key: unknown, error: Error) => void;
}

function normalizeResults(results: unknown): unknown[] {
  return Array.isArray(results) ? results : [];
}

export function createPerplexityHandler(deps: PerplexityHandlerDeps) {
  return async function searchPerplexity(input: Record<string, unknown>) {
    const payload = compactObject({
      query: input.query,
      max_results: input.max_results ?? 10,
      max_tokens_per_page: input.max_tokens_per_page ?? 4096,
      country: input.country,
    });

    const { data, attempts } = await callWithKeyRotation({
      providerName: "perplexity",
      keyPool: deps.keyPool,
      timeoutMs: deps.timeoutMs,
      configuredMaxAttempts: deps.maxAttempts,
      onKeyRevoked: deps.onKeyRevoked,
      buildRequest: (apiKey) => ({
        url: `${deps.baseUrl}/search`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        },
      }),
    });

    const response = data && typeof data === "object" ? data as Record<string, unknown> : {};

    const normalized = {
      provider: "perplexity",
      attempts,
      query: input.query,
      results: normalizeResults(response.results),
      usage:
        response.usage && typeof response.usage === "object"
          ? response.usage
          : null,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(normalized, null, 2) }],
      structuredContent: normalized,
    };
  };
}
