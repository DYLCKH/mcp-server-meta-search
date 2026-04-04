import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  KeyPool,
  callWithKeyRotation,
  callSingleRequest,
} from "@meta-search/runtime";
import type { RequestResult } from "@meta-search/runtime";
import {
  compactObject,
  stringifyForToolContent,
  normalizeBaseUrl,
  optionalBoolSchema,
  optionalIntSchema,
  optionalBoolOrEnumSchema,
  optionalNumSchema,
  httpUrlSchema,
  optionalHttpUrlSchema,
} from "@meta-search/shared";
import type { ResolvedConfig } from "@meta-search/config";

export interface RuntimeState {
  config: ResolvedConfig;
  tavilyKeyPool: KeyPool;
  exaKeyPool: KeyPool;
  perplexityKeyPool: KeyPool;
  jinaKeyPool: KeyPool;
  cloudflareKeyPool: KeyPool;
  onKeyRevoked: (
    providerName: string,
    index: number,
    key: unknown,
    error: Error,
  ) => void;
}

function normalizeResults(results: unknown): unknown[] {
  return Array.isArray(results) ? results : [];
}

function registerTools(server: McpServer, rt: RuntimeState): void {
  const {
    config,
    tavilyKeyPool,
    exaKeyPool,
    perplexityKeyPool,
    jinaKeyPool,
    cloudflareKeyPool,
    onKeyRevoked,
  } = rt;

  const requestTimeoutMs = config.request_timeout_ms;
  const maxAttemptsPerRequest = config.max_attempts_per_request;

  const tavilyBaseUrl = normalizeBaseUrl(config.tavily?.base_url, "https://api.tavily.com");
  const exaBaseUrl = normalizeBaseUrl(config.exa?.base_url, "https://api.exa.ai");
  const perplexityBaseUrl = normalizeBaseUrl(config.perplexity?.base_url, "https://api.perplexity.ai");
  const jinaBaseUrl = normalizeBaseUrl(config.jina?.base_url, "https://r.jina.ai");
  const cfBaseUrl = normalizeBaseUrl(config.cloudflare?.base_url, "https://api.cloudflare.com/client/v4");

  const jinaReaderTimeoutSeconds = Math.max(1, Math.min(180, Math.ceil(requestTimeoutMs / 1000)));
  const jinaReaderFixedHeaders: Record<string, string> = {
    Accept: "text/plain",
    "Content-Type": "application/json",
    "X-Respond-With": "markdown",
    "X-Retain-Images": "none",
    "X-Retain-Links": "text",
    "X-Cache-Tolerance": "3600",
    "X-Timeout": String(jinaReaderTimeoutSeconds),
    DNT: "1",
  };

  // --- search_tavily ---
  server.registerTool(
    "search_tavily",
    {
      title: "Tavily Search (Key Rotation)",
      description:
        "Perform web search via Tavily. Best for general search with structured output and built-in answer generation.",
      inputSchema: {
        query: z.string().min(1).describe("The search query to execute with Tavily."),
        max_results: optionalIntSchema(z.number().int().min(1).max(20)).describe("The maximum number of search results to return (1-20, default 5)."),
        search_depth: z
          .enum(["basic", "advanced", "fast", "ultra-fast"])
          .optional()
          .describe("Controls the latency vs. relevance tradeoff."),
        topic: z.enum(["general", "news", "finance"]).optional().describe("The category of the search."),
        time_range: z
          .enum(["day", "week", "month", "year", "d", "w", "m", "y"])
          .optional()
          .describe("The time range back from the current date to filter results."),
        include_domains: z.array(z.string().min(1)).max(300).optional().describe("Domains to include. Maximum 300."),
        exclude_domains: z.array(z.string().min(1)).max(150).optional().describe("Domains to exclude. Maximum 150."),
        include_answer: optionalBoolOrEnumSchema(z.union([z.boolean(), z.enum(["basic", "advanced"])])),
        include_raw_content: optionalBoolOrEnumSchema(z.union([z.boolean(), z.enum(["markdown", "text"])])),
        include_images: optionalBoolSchema(),
        include_image_descriptions: optionalBoolSchema(),
        include_favicon: optionalBoolSchema(),
        auto_parameters: optionalBoolSchema(),
        include_usage: optionalBoolSchema(),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
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
        keyPool: tavilyKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked,
        buildRequest: (apiKey) => ({
          url: `${tavilyBaseUrl}/search`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
        content: [{ type: "text", text: stringifyForToolContent(normalized) }],
        structuredContent: normalized,
      };
    },
  );

  // --- search_exa ---
  server.registerTool(
    "search_exa",
    {
      title: "Exa Search (Key Rotation)",
      description:
        "Perform web search via Exa. Best for semantic search, finding similar content, people/company lookups, and research papers.",
      inputSchema: {
        query: z.string().min(1).describe("The query string for the search"),
        num_results: optionalIntSchema(z.number().int().min(1).max(100)).describe("Number of results (1-100, default 10)"),
        type: z.enum(["neural", "fast", "auto", "deep", "instant"]).optional().describe("Search type"),
        category: z.enum(["company", "research paper", "news", "tweet", "personal site", "financial report", "people"]).optional().describe("Data category to focus on"),
        user_location: z.string().length(2).optional(),
        include_domains: z.array(z.string().min(1)).max(1200).optional().describe("Domains to include"),
        exclude_domains: z.array(z.string().min(1)).max(1200).optional().describe("Domains to exclude"),
        start_crawl_date: z.string().optional(),
        end_crawl_date: z.string().optional(),
        start_published_date: z.string().optional().describe("Only links published after this date (ISO 8601)"),
        end_published_date: z.string().optional().describe("Only links published before this date (ISO 8601)"),
        include_text: optionalBoolSchema(),
        include_highlights: optionalBoolSchema(),
        include_summary: optionalBoolSchema(),
        summary_query: z.string().optional(),
        max_age_hours: optionalIntSchema(z.number().int()),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
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
        keyPool: exaKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked,
        buildRequest: (apiKey) => ({
          url: `${exaBaseUrl}/search`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey as string, Authorization: `Bearer ${apiKey as string}` },
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
        costDollars: response.costDollars && typeof response.costDollars === "object" ? response.costDollars : null,
        results: normalizeResults(response.results),
      };

      return {
        content: [{ type: "text", text: stringifyForToolContent(normalized) }],
        structuredContent: normalized,
      };
    },
  );

  // --- search_perplexity ---
  server.registerTool(
    "search_perplexity",
    {
      title: "Perplexity Search (Key Rotation)",
      description:
        "Perform web search via Perplexity. Best for AI-synthesized answers with inline citations and high factuality.",
      inputSchema: {
        query: z.string().min(1).describe("The search query to execute with Perplexity."),
        max_results: optionalIntSchema(z.number().int().min(1).max(20)).describe("Max results (1-20, default 10)."),
        max_tokens_per_page: optionalIntSchema(z.number().int().min(256).max(2048)).describe("Max tokens per page (256-2048, default 1024)."),
        country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const payload = compactObject({
        query: input.query,
        max_results: input.max_results ?? 10,
        max_tokens_per_page: input.max_tokens_per_page ?? 1024,
        country: input.country,
      });

      const { data, attempts } = await callWithKeyRotation({
        providerName: "perplexity",
        keyPool: perplexityKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked,
        buildRequest: (apiKey) => ({
          url: `${perplexityBaseUrl}/search`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
        usage: response.usage && typeof response.usage === "object" ? response.usage : null,
      };

      return {
        content: [{ type: "text", text: stringifyForToolContent(normalized) }],
        structuredContent: normalized,
      };
    },
  );

  // --- fetch_jina_markdown ---
  server.registerTool(
    "fetch_jina_markdown",
    {
      title: "Fetch Jina Markdown",
      description:
        "Fetch a webpage as Markdown via Jina Reader. Try this first for most public pages; if the content is incomplete or the page needs real browser rendering / JavaScript execution, use fetch_as_markdown next.",
      inputSchema: {
        url: httpUrlSchema.describe("The absolute http(s) URL of the webpage to fetch as Markdown."),
        wait_for_selector: z.string().min(1).optional().describe("CSS selector to wait for before extraction."),
        target_selector: z.string().min(1).optional().describe("CSS selector limiting extraction to a specific part of the page."),
        remove_selector: z.string().min(1).optional().describe("CSS selector to remove from the page before extraction."),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const headers: Record<string, string> = { ...jinaReaderFixedHeaders };
      if (input.wait_for_selector) headers["X-Wait-For-Selector"] = input.wait_for_selector;
      if (input.target_selector) headers["X-Target-Selector"] = input.target_selector;
      if (input.remove_selector) headers["X-Remove-Selector"] = input.remove_selector;

      const buildRequest = (apiKey?: string) => ({
        url: `${jinaBaseUrl}/`,
        init: {
          method: "POST",
          headers: apiKey ? { ...headers, Authorization: `Bearer ${apiKey}` } : headers,
          body: JSON.stringify({ url: input.url }),
        },
      });

      const response: RequestResult = jinaKeyPool.hasKeys()
        ? await callWithKeyRotation({
            providerName: "jina",
            keyPool: jinaKeyPool,
            timeoutMs: requestTimeoutMs,
            configuredMaxAttempts: maxAttemptsPerRequest,
            onKeyRevoked,
            buildRequest: (apiKey) => buildRequest(apiKey as string),
            extractData: (r) => r.rawText,
          })
        : await callSingleRequest({
            providerName: "jina",
            timeoutMs: requestTimeoutMs,
            buildRequest: () => buildRequest(),
            extractData: (r) => r.rawText,
          });

      const markdown = typeof response.data === "string" ? response.data : "";
      const normalized = {
        provider: "jina_reader",
        attempts: response.attempts,
        url: input.url,
        authenticated: jinaKeyPool.hasKeys(),
      };

      return {
        content: [{ type: "text", text: markdown }],
        structuredContent: normalized,
      };
    },
  );

  // --- fetch_as_markdown ---
  server.registerTool(
    "fetch_as_markdown",
    {
      title: "Fetch as Markdown (Cloudflare Browser Fallback)",
      description:
        "Browser-rendered Markdown fallback via Cloudflare. Use this after fetch_jina_markdown when content is missing, login-gated, or requires real browser rendering / JavaScript execution.",
      inputSchema: z.object({
        url: optionalHttpUrlSchema.describe("The absolute http(s) URL. Required unless html is provided."),
        html: z.string().min(1).optional().describe("Raw HTML to convert directly. Provide either html or url."),
        cacheTTL: optionalIntSchema(z.number().int().min(0).max(86400)).describe("Cache TTL in seconds (0 to disable, max 86400). Default: 5."),
        gotoOptions: z.object({
          waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().describe("When to consider navigation complete."),
          timeout: optionalIntSchema(z.number().int().min(0).max(60000)).describe("Max navigation time in ms."),
        }).optional().describe("Navigation options controlling page load behavior."),
        waitForSelector: z.object({
          selector: z.string().min(1).describe("CSS selector to wait for before extraction."),
          visible: optionalBoolSchema().describe("Wait until element is visible."),
          hidden: optionalBoolSchema().describe("Wait until element is hidden."),
          timeout: optionalIntSchema(z.number().int().min(0).max(60000)).describe("Max wait time for selector in ms."),
        }).optional().describe("Wait for a specific CSS selector before extraction."),
        rejectRequestPattern: z.array(z.string()).optional().describe("Regex patterns for request URLs to block."),
        rejectResourceTypes: z.array(z.string()).optional().describe("Resource types to block."),
        allowRequestPattern: z.array(z.string()).optional().describe("Regex patterns for allowed request URLs."),
        allowResourceTypes: z.array(z.string()).optional().describe("Resource types to allow."),
        cookies: z.array(z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional(),
          secure: optionalBoolSchema(),
          httpOnly: optionalBoolSchema(),
        })).optional().describe("Cookies to set before navigation."),
        authenticate: z.object({
          username: z.string(),
          password: z.string(),
        }).optional().describe("HTTP Basic Auth credentials."),
        setExtraHTTPHeaders: z.record(z.string(), z.string()).optional().describe("Custom HTTP headers."),
        viewport: z.object({
          width: optionalIntSchema(z.number().int()),
          height: optionalIntSchema(z.number().int()),
          deviceScaleFactor: optionalNumSchema(z.number()),
        }).optional().describe("Browser viewport dimensions."),
        userAgent: z.string().optional().describe("Custom User-Agent string."),
        addScriptTag: z.array(z.object({
          content: z.string().optional(),
          url: z.string().optional(),
        })).optional().describe("JavaScript tags to inject before rendering."),
        addStyleTag: z.array(z.object({
          content: z.string().optional(),
          url: z.string().optional(),
        })).optional().describe("CSS tags to inject before rendering."),
        setJavaScriptEnabled: optionalBoolSchema().describe("Enable/disable JavaScript execution (default: true)."),
      }).superRefine((val, ctx) => {
        if (!val.url && !val.html) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "Provide either url or html." });
        }
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      if (!cloudflareKeyPool.hasKeys()) {
        throw new Error("cloudflare: no credentials configured. Add accounts to config.jsonc.");
      }

      const queryParams = input.cacheTTL !== undefined ? `?cacheTTL=${input.cacheTTL}` : "";

      const payload = compactObject({
        url: input.url,
        html: input.html,
        gotoOptions: input.gotoOptions,
        waitForSelector: input.waitForSelector,
        rejectRequestPattern: input.rejectRequestPattern,
        rejectResourceTypes: input.rejectResourceTypes,
        allowRequestPattern: input.allowRequestPattern,
        allowResourceTypes: input.allowResourceTypes,
        cookies: input.cookies,
        authenticate: input.authenticate,
        setExtraHTTPHeaders: input.setExtraHTTPHeaders,
        viewport: input.viewport,
        userAgent: input.userAgent,
        addScriptTag: input.addScriptTag,
        addStyleTag: input.addStyleTag,
        setJavaScriptEnabled: input.setJavaScriptEnabled,
      });

      const { data, attempts } = await callWithKeyRotation({
        providerName: "cloudflare",
        keyPool: cloudflareKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked,
        buildRequest: (cred) => {
          const c = cred as { accountId: string; token: string };
          return {
            url: `${cfBaseUrl}/accounts/${c.accountId}/browser-rendering/markdown${queryParams}`,
            init: {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
              body: JSON.stringify(payload),
            },
          };
        },
      });

      const response = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const markdown =
        typeof response.result === "string"
          ? response.result
          : typeof data === "string"
            ? data
            : "";

      const normalized = {
        provider: "cloudflare_browser_rendering",
        attempts,
        success: response.success ?? null,
        url: input.url,
        markdown,
      };

      return {
        content: [{ type: "text", text: markdown || stringifyForToolContent(normalized) }],
        structuredContent: normalized,
      };
    },
  );
}

export function createMcpServer(rt: RuntimeState): McpServer {
  const server = new McpServer({
    name: "meta-search",
    version: "2.0.0",
  });

  registerTools(server, rt);
  return server;
}

export function createTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
}
