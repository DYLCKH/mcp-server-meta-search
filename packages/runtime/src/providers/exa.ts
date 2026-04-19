import { z } from "zod";
import {
  compactObject,
  optionalIntSchema,
  optionalBoolSchema,
} from "@meta-search/shared";
import type { KeyPool } from "../key-pool.js";
import { callWithKeyRotation } from "../http-client.js";

export const TOOL_NAME = "search_exa";

export const TOOL_DEFINITION = {
  title: "Exa Search (Key Rotation)",
  description:
    "Perform web search via Exa. Best for semantic search, finding similar content, people/company lookups, and research papers.",
  inputSchema: {
    query: z.string().min(1).describe("The query string for the search"),
    num_results: optionalIntSchema(z.number().int().min(1).max(100)).describe("Number of results to return (1-100, default 10)"),
    type: z.enum(["neural", "fast", "auto", "deep", "instant"]).optional().describe("Search type: neural (embeddings-based), auto (default, intelligently combines methods), fast (streamlined models), deep (light deep search), instant (lowest latency for real-time apps)"),
    category: z
      .enum([
        "company",
        "research paper",
        "news",
        "tweet",
        "personal site",
        "financial report",
        "people",
      ])
      .optional()
      .describe("A data category to focus on. 'people' and 'company' have improved quality for LinkedIn profiles and company pages. Note: 'company' and 'people' categories only support a limited set of filters"),
    user_location: z.string().length(2).optional(),
    include_domains: z.array(z.string().min(1)).max(1200).optional().describe("List of domains to include in the search. If specified, results will only come from these domains"),
    exclude_domains: z.array(z.string().min(1)).max(1200).optional().describe("List of domains to exclude from search results. If specified, no results will be returned from these domains"),
    start_crawl_date: z.string().optional(),
    end_crawl_date: z.string().optional(),
    start_published_date: z.string().optional().describe("Only links with a published date after this will be returned. Must be in ISO 8601 format"),
    end_published_date: z.string().optional().describe("Only links with a published date before this will be returned. Must be in ISO 8601 format"),
    include_text: optionalBoolSchema(),
    include_highlights: optionalBoolSchema(),
    include_summary: optionalBoolSchema(),
    summary_query: z.string().optional(),
    max_age_hours: optionalIntSchema(z.number().int()),
  },
  annotations: {
    readOnlyHint: true,
  },
} as const;

export interface ExaHandlerDeps {
  baseUrl: string;
  keyPool: KeyPool;
  timeoutMs: number;
  maxAttempts: number;
  onKeyRevoked: (providerName: string, index: number, key: unknown, error: Error) => void;
}

function normalizeResults(results: unknown): unknown[] {
  return Array.isArray(results) ? results : [];
}

export function createExaHandler(deps: ExaHandlerDeps) {
  return async function searchExa(input: Record<string, unknown>) {
    const includeText = input.include_text !== false;
    const includeHighlights = input.include_highlights !== false;

    const summary =
      input.include_summary || input.summary_query
        ? compactObject({ query: input.summary_query })
        : undefined;

    const contents = compactObject({
      text: includeText || undefined,
      highlights: includeHighlights || undefined,
      summary,
      maxAgeHours: input.max_age_hours,
    });

    const payload = compactObject({
      query: input.query,
      numResults: input.num_results,
      type: input.type,
      category: input.category,
      userLocation: input.user_location,
      includeDomains: input.include_domains,
      excludeDomains: input.exclude_domains,
      startCrawlDate: input.start_crawl_date,
      endCrawlDate: input.end_crawl_date,
      startPublishedDate: input.start_published_date,
      endPublishedDate: input.end_published_date,
      contents: Object.keys(contents).length > 0 ? contents : undefined,
    });

    const { data, attempts } = await callWithKeyRotation({
      providerName: "exa",
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
            "x-api-key": apiKey as string,
          },
          body: JSON.stringify(payload),
        },
      }),
    });

    const response = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const normalized = {
      provider: "exa",
      attempts,
      requestId: typeof response.requestId === "string" ? response.requestId : null,
      searchType: typeof response.searchType === "string" ? response.searchType : null,
      query: input.query,
      costDollars:
        response.costDollars && typeof response.costDollars === "object"
          ? response.costDollars
          : null,
      results: normalizeResults(response.results),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(normalized, null, 2) }],
      structuredContent: normalized,
    };
  };
}
