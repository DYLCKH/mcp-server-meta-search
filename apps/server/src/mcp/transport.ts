import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CLOUDFLARE_TOOL_DEFINITION,
  EXA_TOOL_DEFINITION,
  JINA_TOOL_DEFINITION,
  KeyPool,
  PERPLEXITY_TOOL_DEFINITION,
  TAVILY_TOOL_DEFINITION,
  callSingleRequest,
  callWithPerf,
} from "@meta-search/runtime";
import type { RequestResult, PerfInstances, PerfMiddleware } from "@meta-search/runtime";
import {
  compactObject,
  normalizeBaseUrl,
  stringifyForToolContent,
} from "@meta-search/shared";
import type { ResolvedConfig } from "@meta-search/config";

// ---------------------------------------------------------------------------
// MCP request logger injection
// ---------------------------------------------------------------------------

export interface McpRequestLogEntry {
  tool: string;
  provider: string | null;
  pat_name: string | null;
  status: "success" | "error";
  latency_ms: number;
  error?: string;
  attempts?: number;
}

type McpLogger = (entry: McpRequestLogEntry) => void;

// The logger is injected by the host app (apps/server/src/index.ts) so that
// transport.ts doesn't depend on `bun:sqlite` at module load — keeps this file
// importable from test environments that run on Node.
let mcpLogger: McpLogger = () => {};

export function setMcpLogger(fn: McpLogger): void {
  mcpLogger = fn;
}

export interface RuntimeState {
  config: ResolvedConfig;
  perf?: PerfInstances;
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

export interface RuntimeStateRefLike {
  current: RuntimeState;
}

function normalizeResults(results: unknown): unknown[] {
  return Array.isArray(results) ? results : [];
}

function normalizeResponseTime(responseTime: unknown): string | number | null {
  return typeof responseTime === "string" || typeof responseTime === "number"
    ? responseTime
    : null;
}

// ---------------------------------------------------------------------------
// MCP request logging
// ---------------------------------------------------------------------------

const TOOL_PROVIDER_MAP: Record<string, string> = {
  search_tavily: "tavily",
  search_exa: "exa",
  search_perplexity: "perplexity",
  fetch_jina_markdown: "jina",
  fetch_as_markdown: "cloudflare",
};

interface McpCallContext {
  patName: string | null;
}

export const mcpCallContext = new AsyncLocalStorage<McpCallContext>();

type ToolHandler<TInput, TResult> = (input: TInput) => Promise<TResult>;

function withRequestLogging<TInput, TResult extends { structuredContent?: unknown }>(
  toolName: string,
  handler: ToolHandler<TInput, TResult>,
): ToolHandler<TInput, TResult> {
  return async (input: TInput) => {
    const start = Date.now();
    const provider = TOOL_PROVIDER_MAP[toolName] ?? null;
    const ctx = mcpCallContext.getStore();
    try {
      const result = await handler(input);
      const structured = result.structuredContent as
        | { attempts?: unknown }
        | undefined;
      const attempts =
        typeof structured?.attempts === "number" ? structured.attempts : 1;
      mcpLogger({
        tool: toolName,
        provider,
        pat_name: ctx?.patName ?? null,
        status: "success",
        latency_ms: Date.now() - start,
        attempts,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mcpLogger({
        tool: toolName,
        provider,
        pat_name: ctx?.patName ?? null,
        status: "error",
        latency_ms: Date.now() - start,
        error: msg.slice(0, 500),
      });
      throw err;
    }
  };
}

function hashPayload(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function makePerf(rt: RuntimeState, provider: string): PerfMiddleware | undefined {
  const perf = rt.perf;
  if (!perf) return undefined;

  const middleware: PerfMiddleware = {
    limiter: perf.limiter,
    metrics: perf.metrics,
  };

  if (rt.config.performance.cache.enabled) {
    middleware.cache = perf.cache;
  }
  if (rt.config.performance.circuitBreaker.enabled) {
    middleware.circuitBreaker = perf.getCircuitBreaker(provider);
  }
  if (rt.config.performance.singleFlight.enabled) {
    middleware.singleFlight = perf.singleFlight;
  }

  return middleware;
}

function getRuntimeRequestConfig(runtimeStateRef: RuntimeStateRefLike) {
  const rt = runtimeStateRef.current;
  const config = rt.config;

  return {
    rt,
    config,
    requestTimeoutMs: config.request_timeout_ms,
    maxAttemptsPerRequest: config.max_attempts_per_request,
  };
}

export function createTavilyToolHandler(runtimeStateRef: RuntimeStateRefLike) {
  return async (input: Record<string, unknown>) => {
    const { rt, config, requestTimeoutMs, maxAttemptsPerRequest } =
      getRuntimeRequestConfig(runtimeStateRef);
    const tavilyBaseUrl = normalizeBaseUrl(
      config.tavily?.base_url,
      "https://api.tavily.com",
    );

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

    const { data, attempts } = await callWithPerf({
      providerName: "tavily",
      keyPool: rt.tavilyKeyPool,
      timeoutMs: requestTimeoutMs,
      configuredMaxAttempts: maxAttemptsPerRequest,
      onKeyRevoked: rt.onKeyRevoked,
      perf: makePerf(rt, "tavily"),
      cacheKey: `tavily:search:${JSON.stringify(payload)}`,
      buildRequest: (apiKey) => ({
        url: `${tavilyBaseUrl}/search`,
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
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const normalized = {
      provider: "tavily",
      attempts,
      request_id:
        typeof response.request_id === "string" ? response.request_id : null,
      query: typeof response.query === "string" ? response.query : input.query,
      answer: typeof response.answer === "string" ? response.answer : null,
      response_time: normalizeResponseTime(response.response_time),
      usage:
        response.usage && typeof response.usage === "object"
          ? response.usage
          : null,
      images: normalizeResults(response.images),
      results: normalizeResults(response.results),
    };

    return {
      content: [{ type: "text", text: stringifyForToolContent(normalized) }],
      structuredContent: normalized,
    };
  };
}

function registerTools(server: McpServer, runtimeStateRef: RuntimeStateRefLike): void {
  // --- search_tavily ---
  server.registerTool(
    "search_tavily",
    {
      title: TAVILY_TOOL_DEFINITION.title,
      description: TAVILY_TOOL_DEFINITION.description,
      inputSchema: TAVILY_TOOL_DEFINITION.inputSchema,
      annotations: TAVILY_TOOL_DEFINITION.annotations,
    },
    withRequestLogging("search_tavily", createTavilyToolHandler(runtimeStateRef)),
  );

  // --- search_exa ---
  server.registerTool(
    "search_exa",
    {
      title: EXA_TOOL_DEFINITION.title,
      description: EXA_TOOL_DEFINITION.description,
      inputSchema: EXA_TOOL_DEFINITION.inputSchema,
      annotations: EXA_TOOL_DEFINITION.annotations,
    },
    withRequestLogging("search_exa", async (input) => {
      const { rt, config, requestTimeoutMs, maxAttemptsPerRequest } =
        getRuntimeRequestConfig(runtimeStateRef);
      const includeText = input.include_text !== false;
      const includeHighlights = input.include_highlights !== false;
      const exaBaseUrl = normalizeBaseUrl(
        config.exa?.base_url,
        "https://api.exa.ai",
      );

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

      const { data, attempts } = await callWithPerf({
        providerName: "exa",
        keyPool: rt.exaKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked: rt.onKeyRevoked,
        perf: makePerf(rt, "exa"),
        cacheKey: `exa:search:${JSON.stringify(payload)}`,
        buildRequest: (apiKey) => ({
          url: `${exaBaseUrl}/search`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey as string },
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
    }),
  );

  // --- search_perplexity ---
  server.registerTool(
    "search_perplexity",
    {
      title: PERPLEXITY_TOOL_DEFINITION.title,
      description: PERPLEXITY_TOOL_DEFINITION.description,
      inputSchema: PERPLEXITY_TOOL_DEFINITION.inputSchema,
      annotations: PERPLEXITY_TOOL_DEFINITION.annotations,
    },
    withRequestLogging("search_perplexity", async (input) => {
      const { rt, config, requestTimeoutMs, maxAttemptsPerRequest } =
        getRuntimeRequestConfig(runtimeStateRef);
      const perplexityBaseUrl = normalizeBaseUrl(
        config.perplexity?.base_url,
        "https://api.perplexity.ai",
      );
      const payload = compactObject({
        query: input.query,
        max_results: input.max_results ?? 10,
        max_tokens_per_page: input.max_tokens_per_page ?? 4096,
        country: input.country,
      });

      const { data, attempts } = await callWithPerf({
        providerName: "perplexity",
        keyPool: rt.perplexityKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked: rt.onKeyRevoked,
        perf: makePerf(rt, "perplexity"),
        cacheKey: `perplexity:search:${JSON.stringify(payload)}`,
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
    }),
  );

  // --- fetch_jina_markdown ---
  server.registerTool(
    "fetch_jina_markdown",
    {
      title: JINA_TOOL_DEFINITION.title,
      description: JINA_TOOL_DEFINITION.description,
      inputSchema: JINA_TOOL_DEFINITION.inputSchema,
      annotations: JINA_TOOL_DEFINITION.annotations,
    },
    withRequestLogging("fetch_jina_markdown", async (input) => {
      const { rt, config, requestTimeoutMs, maxAttemptsPerRequest } =
        getRuntimeRequestConfig(runtimeStateRef);
      const jinaBaseUrl = normalizeBaseUrl(
        config.jina?.base_url,
        "https://r.jina.ai",
      );
      const jinaReaderTimeoutSeconds = Math.max(
        1,
        Math.min(180, Math.ceil(requestTimeoutMs / 1000)),
      );
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

      const response: RequestResult = rt.jinaKeyPool.hasKeys()
        ? await callWithPerf({
            providerName: "jina",
            keyPool: rt.jinaKeyPool,
            timeoutMs: requestTimeoutMs,
            configuredMaxAttempts: maxAttemptsPerRequest,
            onKeyRevoked: rt.onKeyRevoked,
            perf: makePerf(rt, "jina"),
            cacheKey: `jina:fetch:${input.url}`,
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
        authenticated: rt.jinaKeyPool.hasKeys(),
      };

      return {
        content: [{ type: "text", text: markdown }],
        structuredContent: normalized,
      };
    }),
  );

  // --- fetch_as_markdown ---
  server.registerTool(
    "fetch_as_markdown",
    {
      title: CLOUDFLARE_TOOL_DEFINITION.title,
      description: CLOUDFLARE_TOOL_DEFINITION.description,
      inputSchema: CLOUDFLARE_TOOL_DEFINITION.inputSchema,
      annotations: CLOUDFLARE_TOOL_DEFINITION.annotations,
    },
    withRequestLogging("fetch_as_markdown", async (input) => {
      const { rt, config, requestTimeoutMs, maxAttemptsPerRequest } =
        getRuntimeRequestConfig(runtimeStateRef);
      const cfBaseUrl = normalizeBaseUrl(
        config.cloudflare?.base_url,
        "https://api.cloudflare.com/client/v4",
      );

      if (!rt.cloudflareKeyPool.hasKeys()) {
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

      const { data, attempts } = await callWithPerf({
        providerName: "cloudflare",
        keyPool: rt.cloudflareKeyPool,
        timeoutMs: requestTimeoutMs,
        configuredMaxAttempts: maxAttemptsPerRequest,
        onKeyRevoked: rt.onKeyRevoked,
        perf: makePerf(rt, "cloudflare"),
        cacheKey: `cloudflare:fetch:${hashPayload({
          url: input.url ?? null,
          html: input.html ? true : false,
          payload,
          queryParams,
        })}`,
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
    }),
  );
}

export function createMcpServer(runtimeStateRef: RuntimeStateRefLike): McpServer {
  const server = new McpServer({
    name: "meta-search",
    version: "2.0.0",
  });

  registerTools(server, runtimeStateRef);
  return server;
}

export function createTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
}
