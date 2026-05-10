import { z } from "zod";
import {
  compactObject,
  optionalIntSchema,
  optionalBoolOrEnumSchema,
  optionalBoolSchema,
  optionalNumSchema,
} from "@meta-search/shared";
import type { KeyPool } from "../key-pool.js";
import { callWithKeyRotation } from "../http-client.js";

export const TOOL_NAME = "search_tavily";
export const CRAWL_TOOL_NAME = "crawl_tavily";
export const USAGE_TOOL_NAME = "check_tavily_usage";

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

export const CRAWL_TOOL_DEFINITION = {
  title: "Tavily Crawl (Key Rotation)",
  description:
    "Crawl a website via Tavily and return extracted pages. Best for mapping and extracting multiple pages from a domain or site section.",
  inputSchema: {
    url: z
      .string()
      .min(1)
      .describe(
        "The root URL or domain to crawl, e.g. https://docs.tavily.com or docs.tavily.com.",
      ),
    instructions: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Natural-language crawl instructions. Enabling instructions increases Tavily crawl credit usage.",
      ),
    chunks_per_source: optionalIntSchema(z.number().int().min(1).max(5))
      .describe("Maximum relevant chunks per source when instructions are provided (1-5)."),
    max_depth: optionalIntSchema(z.number().int().min(1).max(5))
      .describe("Maximum link depth from the starting URL (1-5)."),
    max_breadth: optionalIntSchema(z.number().int().min(1).max(500))
      .describe("Maximum links to follow per page (1-500)."),
    limit: optionalIntSchema(z.number().int().min(1))
      .describe("Maximum number of pages to crawl."),
    select_paths: z
      .array(z.string().min(1))
      .optional()
      .describe("Regex paths to include, e.g. ['/docs/.*']."),
    select_domains: z
      .array(z.string().min(1))
      .optional()
      .describe("Domains to include in the crawl."),
    exclude_paths: z
      .array(z.string().min(1))
      .optional()
      .describe("Regex paths to exclude, e.g. ['/private/.*']."),
    exclude_domains: z
      .array(z.string().min(1))
      .optional()
      .describe("Domains to exclude from the crawl."),
    allow_external: optionalBoolSchema()
      .describe("Allow crawling external links outside the starting domain."),
    include_images: optionalBoolSchema()
      .describe("Include image URLs in extracted page results."),
    extract_depth: z
      .enum(["basic", "advanced"])
      .optional()
      .describe(
        "Extraction depth. 'advanced' is more comprehensive and uses more credits.",
      ),
    format: z
      .enum(["markdown", "text"])
      .optional()
      .describe("Content format for extracted pages."),
    include_favicon: optionalBoolSchema()
      .describe("Include favicon URL when Tavily returns it."),
    timeout: optionalNumSchema(z.number().min(10).max(150))
      .describe("Crawl timeout in seconds (10-150)."),
  },
  annotations: {
    readOnlyHint: true,
  },
} as const;

export const USAGE_TOOL_DEFINITION = {
  title: "Tavily Usage (Key Rotation)",
  description:
    "Check Tavily API credit usage and limits for the selected API key/account.",
  inputSchema: {
    project_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional Tavily project ID to scope the usage lookup."),
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

function normalizeResponseTime(responseTime: unknown): string | number | null {
  return typeof responseTime === "string" || typeof responseTime === "number"
    ? responseTime
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function remainingCredits(
  usageSource: Record<string, unknown> | null,
  usageField: string,
  limitField: string,
): number | null {
  if (!usageSource) return null;

  const usage = toFiniteNumber(usageSource[usageField]);
  const limit = toFiniteNumber(usageSource[limitField]);
  return usage === null || limit === null ? null : limit - usage;
}

export function normalizeTavilyUsageResponse(
  data: unknown,
  attempts: number,
  projectId?: unknown,
) {
  const response = asRecord(data) ?? {};
  const key = asRecord(response.key);
  const account = asRecord(response.account);

  const normalizedKey = key
    ? {
        ...key,
        remaining: remainingCredits(key, "usage", "limit"),
      }
    : null;
  const normalizedAccount = account
    ? {
        ...account,
        plan_remaining: remainingCredits(account, "plan_usage", "plan_limit"),
        paygo_remaining: remainingCredits(
          account,
          "paygo_usage",
          "paygo_limit",
        ),
      }
    : null;

  return {
    provider: "tavily_usage",
    attempts,
    project_id: typeof projectId === "string" ? projectId : null,
    key: normalizedKey,
    account: normalizedAccount,
  };
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
      response_time: normalizeResponseTime(response.response_time),
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

export function createTavilyCrawlHandler(deps: TavilyHandlerDeps) {
  return async function crawlTavily(input: Record<string, unknown>) {
    const payload = compactObject({
      url: input.url,
      instructions: input.instructions,
      chunks_per_source: input.chunks_per_source,
      max_depth: input.max_depth,
      max_breadth: input.max_breadth,
      limit: input.limit,
      select_paths: input.select_paths,
      select_domains: input.select_domains,
      exclude_paths: input.exclude_paths,
      exclude_domains: input.exclude_domains,
      allow_external: input.allow_external,
      include_images: input.include_images,
      extract_depth: input.extract_depth,
      format: input.format,
      include_favicon: input.include_favicon,
      timeout: input.timeout,
    });

    const { data, attempts } = await callWithKeyRotation({
      providerName: "tavily",
      keyPool: deps.keyPool,
      timeoutMs: deps.timeoutMs,
      configuredMaxAttempts: deps.maxAttempts,
      onKeyRevoked: deps.onKeyRevoked,
      buildRequest: (apiKey) => ({
        url: `${deps.baseUrl}/crawl`,
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

    const response =
      data && typeof data === "object" ? data as Record<string, unknown> : {};
    const normalized = {
      provider: "tavily_crawl",
      attempts,
      request_id:
        typeof response.request_id === "string" ? response.request_id : null,
      base_url:
        typeof response.base_url === "string" ? response.base_url : input.url,
      response_time: normalizeResponseTime(response.response_time),
      usage:
        response.usage && typeof response.usage === "object"
          ? response.usage
          : null,
      results: normalizeResults(response.results),
      failed_results: normalizeResults(response.failed_results),
    };

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(normalized, null, 2) },
      ],
      structuredContent: normalized,
    };
  };
}

export function createTavilyUsageHandler(deps: TavilyHandlerDeps) {
  return async function checkTavilyUsage(input: Record<string, unknown>) {
    const projectId =
      typeof input.project_id === "string" && input.project_id.trim()
        ? input.project_id.trim()
        : undefined;

    const { data, attempts } = await callWithKeyRotation({
      providerName: "tavily",
      keyPool: deps.keyPool,
      timeoutMs: deps.timeoutMs,
      configuredMaxAttempts: deps.maxAttempts,
      onKeyRevoked: deps.onKeyRevoked,
      buildRequest: (apiKey) => ({
        url: `${deps.baseUrl}/usage`,
        init: {
          method: "GET",
          headers: compactObject({
            Authorization: `Bearer ${apiKey}`,
            "X-Project-ID": projectId,
          }) as Record<string, string>,
        },
      }),
    });

    const normalized = normalizeTavilyUsageResponse(
      data,
      attempts,
      projectId,
    );

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(normalized, null, 2) },
      ],
      structuredContent: normalized,
    };
  };
}
