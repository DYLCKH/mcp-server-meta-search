import { z } from "zod";
import {
  compactObject,
  optionalIntSchema,
  optionalBoolOrEnumSchema,
  optionalBoolSchema,
} from "@meta-search/shared";
import type { KeyPool } from "../key-pool.js";
import { callWithKeyRotation } from "../http-client.js";

export const TOOL_NAME = "search_tavily";

export const TOOL_DEFINITION = {
  title: "Tavily Search (Key Rotation)",
  description:
    "Perform web search via Tavily. Best for general search with structured output and built-in answer generation.",
  inputSchema: {
    query: z.string().min(1).describe("The search query to execute with Tavily."),
    max_results: optionalIntSchema(z.number().int().min(1).max(20)).describe("The maximum number of search results to return (1-20, default 5)."),
    search_depth: z
      .enum(["basic", "advanced", "fast", "ultra-fast"])
      .optional()
      .describe("Controls the latency vs. relevance tradeoff. 'advanced' gives highest relevance (2 credits), 'basic' is balanced, 'fast' prioritizes lower latency, 'ultra-fast' minimizes latency above all."),
    topic: z.enum(["general", "news", "finance"]).optional().describe("The category of the search. 'news' for real-time updates on politics/sports/events, 'finance' for financial data, 'general' for broad searches."),
    time_range: z
      .enum(["day", "week", "month", "year", "d", "w", "m", "y"])
      .optional()
      .describe("The time range back from the current date to filter results based on publish date or last updated date."),
    include_domains: z.array(z.string().min(1)).max(300).optional().describe("A list of domains to specifically include in the search results. Maximum 300 domains."),
    exclude_domains: z.array(z.string().min(1)).max(150).optional().describe("A list of domains to specifically exclude from the search results. Maximum 150 domains."),
    include_answer: optionalBoolOrEnumSchema(
      z.union([z.boolean(), z.enum(["basic", "advanced"])]),
    ),
    include_raw_content: optionalBoolOrEnumSchema(
      z.union([z.boolean(), z.enum(["markdown", "text"])]),
    ),
    include_images: optionalBoolSchema(),
    include_image_descriptions: optionalBoolSchema(),
    include_favicon: optionalBoolSchema(),
    auto_parameters: optionalBoolSchema(),
    include_usage: optionalBoolSchema(),
  },
  annotations: {
    readOnlyHint: true,
  },
} as const;

export interface TavilyHandlerDeps {
  baseUrl: string;
  keyPool: KeyPool;
  timeoutMs: number;
  maxAttempts: number;
  onKeyRevoked: (providerName: string, index: number, key: unknown, error: Error) => void;
}

function normalizeResults(results: unknown): unknown[] {
  return Array.isArray(results) ? results : [];
}

export function createTavilyHandler(deps: TavilyHandlerDeps) {
  return async function searchTavily(input: Record<string, unknown>) {
    const payload = compactObject({
      query: input.query,
      max_results: input.max_results,
      search_depth: input.search_depth,
      topic: input.topic,
      time_range: input.time_range,
      include_domains: input.include_domains,
      exclude_domains: input.exclude_domains,
      include_answer: input.include_answer,
      include_raw_content: input.include_raw_content,
      include_images: input.include_images,
      include_image_descriptions: input.include_image_descriptions,
      include_favicon: input.include_favicon,
      auto_parameters: input.auto_parameters,
      include_usage: input.include_usage,
    });

    const { data, attempts } = await callWithKeyRotation({
      providerName: "tavily",
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
      provider: "tavily",
      attempts,
      request_id: typeof response.request_id === "string" ? response.request_id : null,
      query: typeof response.query === "string" ? response.query : input.query,
      answer: typeof response.answer === "string" ? response.answer : null,
      response_time: typeof response.response_time === "number" ? response.response_time : null,
      usage: response.usage && typeof response.usage === "object" ? response.usage : null,
      images: normalizeResults(response.images),
      results: normalizeResults(response.results),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(normalized, null, 2) }],
      structuredContent: normalized,
    };
  };
}
