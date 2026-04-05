// @meta-search/runtime — provider engine, KeyPool, tool definitions

// --- Core types & classes ---
export { KeyPool, hashToken, generatePat } from "./key-pool.js";
export type { KeySelection, KeyHealthState, KeyPoolOpts, KeyPoolHealthOpts } from "./key-pool.js";

// --- HTTP client ---
export {
  fetchResponseWithTimeout,
  callSingleRequest,
  callWithKeyRotation,
  callWithPerf,
  defaultExtractSuccessData,
} from "./http-client.js";
export type { FetchResponse, ExtractDataFn, SingleRequestOpts, KeyRotationOpts, RequestResult, PerfMiddleware, CallWithPerfOpts } from "./http-client.js";

// --- Performance primitives ---
export {
  ResultCache,
  ConcurrencyLimiter,
  SingleFlight,
  CircuitBreaker,
  CircuitOpenError,
  MetricsCollector,
} from "./perf/index.js";
export type {
  CacheConfig,
  ConcurrencyConfig,
  CircuitBreakerConfig,
  CircuitState,
  ProviderStats,
} from "./perf/index.js";

// --- Invalid key tracking ---
export { createKeyRevokedHandler } from "./invalid-keys.js";

// --- Provider tool definitions ---
export { TOOL_NAME as TAVILY_TOOL_NAME, TOOL_DEFINITION as TAVILY_TOOL_DEFINITION, createTavilyHandler } from "./providers/tavily.js";
export type { TavilyHandlerDeps } from "./providers/tavily.js";

export { TOOL_NAME as EXA_TOOL_NAME, TOOL_DEFINITION as EXA_TOOL_DEFINITION, createExaHandler } from "./providers/exa.js";
export type { ExaHandlerDeps } from "./providers/exa.js";

export { TOOL_NAME as PERPLEXITY_TOOL_NAME, TOOL_DEFINITION as PERPLEXITY_TOOL_DEFINITION, createPerplexityHandler } from "./providers/perplexity.js";
export type { PerplexityHandlerDeps } from "./providers/perplexity.js";

export { TOOL_NAME as JINA_TOOL_NAME, TOOL_DEFINITION as JINA_TOOL_DEFINITION, createJinaHandler } from "./providers/jina.js";
export type { JinaHandlerDeps } from "./providers/jina.js";

export { TOOL_NAME as CLOUDFLARE_TOOL_NAME, TOOL_DEFINITION as CLOUDFLARE_TOOL_DEFINITION, createCloudflareHandler } from "./providers/cloudflare.js";
export type { CloudflareHandlerDeps } from "./providers/cloudflare.js";

// --- Provider factory ---
import type { ResolvedConfig, ResolvedPerformanceConfig } from "@meta-search/config";
import { normalizeBaseUrl } from "@meta-search/shared";
import { KeyPool } from "./key-pool.js";
import type { KeyPoolOpts } from "./key-pool.js";
import { createKeyRevokedHandler } from "./invalid-keys.js";
import { ResultCache } from "./perf/cache.js";
import { ConcurrencyLimiter } from "./perf/concurrency.js";
import { SingleFlight } from "./perf/single-flight.js";
import { CircuitBreaker } from "./perf/circuit-breaker.js";
import { MetricsCollector } from "./perf/metrics.js";
import { createTavilyHandler } from "./providers/tavily.js";
import { createExaHandler } from "./providers/exa.js";
import { createPerplexityHandler } from "./providers/perplexity.js";
import { createJinaHandler } from "./providers/jina.js";
import { createCloudflareHandler } from "./providers/cloudflare.js";
import { TOOL_DEFINITION as tavilyDef } from "./providers/tavily.js";
import { TOOL_DEFINITION as exaDef } from "./providers/exa.js";
import { TOOL_DEFINITION as pplxDef } from "./providers/perplexity.js";
import { TOOL_DEFINITION as jinaDef } from "./providers/jina.js";
import { TOOL_DEFINITION as cfDef } from "./providers/cloudflare.js";

export interface ProviderInstances {
  tavily: {
    baseUrl: string;
    keyPool: KeyPool;
    handler: ReturnType<typeof createTavilyHandler>;
  };
  exa: {
    baseUrl: string;
    keyPool: KeyPool;
    handler: ReturnType<typeof createExaHandler>;
  };
  perplexity: {
    baseUrl: string;
    keyPool: KeyPool;
    handler: ReturnType<typeof createPerplexityHandler>;
  };
  jina: {
    baseUrl: string;
    keyPool: KeyPool;
    handler: ReturnType<typeof createJinaHandler>;
  };
  cloudflare: {
    baseUrl: string;
    keyPool: KeyPool;
    handler: ReturnType<typeof createCloudflareHandler>;
  };
}

export interface PerfInstances {
  cache: ResultCache;
  limiter: ConcurrencyLimiter;
  singleFlight: SingleFlight;
  metrics: MetricsCollector;
  getCircuitBreaker(providerName: string): CircuitBreaker;
}

export function createPerfInstances(perfConfig: ResolvedPerformanceConfig): PerfInstances {
  const circuitBreakers = new Map<string, CircuitBreaker>();

  return {
    cache: new ResultCache({
      maxSize: perfConfig.cache.maxSize,
      defaultTtlMs: perfConfig.cache.defaultTtlMs,
    }),
    limiter: new ConcurrencyLimiter("global", {
      maxConcurrency: perfConfig.concurrency.maxConcurrency,
      maxQueueSize: perfConfig.concurrency.maxQueueSize,
      queueTimeoutMs: perfConfig.concurrency.queueTimeoutMs,
    }),
    singleFlight: new SingleFlight(),
    metrics: new MetricsCollector(),
    getCircuitBreaker(providerName: string): CircuitBreaker {
      let breaker = circuitBreakers.get(providerName);
      if (!breaker) {
        breaker = new CircuitBreaker(providerName, {
          failureThreshold: perfConfig.circuitBreaker.failureThreshold,
          resetTimeoutMs: perfConfig.circuitBreaker.resetTimeoutMs,
          halfOpenMaxRequests: 1,
        });
        circuitBreakers.set(providerName, breaker);
      }
      return breaker;
    },
  };
}

export function createProviders(config: ResolvedConfig, invalidKeysPath: string): ProviderInstances {
  const strategy = config.key_rotation_strategy === "random" ? "random" : "round_robin";
  const healthOpts: KeyPoolOpts["health"] = {
    recoveryIntervalMs: config.key_recovery_interval_ms,
    maxDisableBeforeRevoke: config.max_disable_before_revoke,
  };
  const onKeyRevoked = createKeyRevokedHandler(invalidKeysPath);

  const commonDeps = {
    timeoutMs: config.request_timeout_ms,
    maxAttempts: config.max_attempts_per_request,
    onKeyRevoked,
  };

  // Tavily
  const tavilyBaseUrl = normalizeBaseUrl(config.tavily?.base_url, "https://api.tavily.com");
  const tavilyKeyPool = new KeyPool({
    providerName: "tavily",
    keys: Array.isArray(config.tavily?.api_keys) ? config.tavily.api_keys : [],
    strategy,
    health: healthOpts,
  });

  // Exa
  const exaBaseUrl = normalizeBaseUrl(config.exa?.base_url, "https://api.exa.ai");
  const exaKeyPool = new KeyPool({
    providerName: "exa",
    keys: Array.isArray(config.exa?.api_keys) ? config.exa.api_keys : [],
    strategy,
    health: healthOpts,
  });

  // Perplexity
  const perplexityBaseUrl = normalizeBaseUrl(config.perplexity?.base_url, "https://api.perplexity.ai");
  const perplexityKeyPool = new KeyPool({
    providerName: "perplexity",
    keys: Array.isArray(config.perplexity?.api_keys) ? config.perplexity.api_keys : [],
    strategy,
    health: healthOpts,
  });

  // Jina
  const jinaBaseUrl = normalizeBaseUrl(config.jina?.base_url, "https://r.jina.ai");
  const jinaKeyPool = new KeyPool({
    providerName: "jina",
    keys: Array.isArray(config.jina?.api_keys) ? config.jina.api_keys : [],
    strategy,
    health: healthOpts,
  });

  // Cloudflare
  const cfBaseUrl = normalizeBaseUrl(config.cloudflare?.base_url, "https://api.cloudflare.com/client/v4");
  const cfCredentials = Array.isArray(config.cloudflare?.accounts)
    ? config.cloudflare.accounts.map((a) => ({
        accountId: a.account_id,
        token: a.api_token,
      }))
    : [];
  const cfKeyPool = new KeyPool({
    providerName: "cloudflare",
    keys: cfCredentials,
    strategy,
    health: healthOpts,
  });

  return {
    tavily: {
      baseUrl: tavilyBaseUrl,
      keyPool: tavilyKeyPool,
      handler: createTavilyHandler({ ...commonDeps, baseUrl: tavilyBaseUrl, keyPool: tavilyKeyPool }),
    },
    exa: {
      baseUrl: exaBaseUrl,
      keyPool: exaKeyPool,
      handler: createExaHandler({ ...commonDeps, baseUrl: exaBaseUrl, keyPool: exaKeyPool }),
    },
    perplexity: {
      baseUrl: perplexityBaseUrl,
      keyPool: perplexityKeyPool,
      handler: createPerplexityHandler({ ...commonDeps, baseUrl: perplexityBaseUrl, keyPool: perplexityKeyPool }),
    },
    jina: {
      baseUrl: jinaBaseUrl,
      keyPool: jinaKeyPool,
      handler: createJinaHandler({ ...commonDeps, baseUrl: jinaBaseUrl, keyPool: jinaKeyPool }),
    },
    cloudflare: {
      baseUrl: cfBaseUrl,
      keyPool: cfKeyPool,
      handler: createCloudflareHandler({ ...commonDeps, baseUrl: cfBaseUrl, keyPool: cfKeyPool }),
    },
  };
}

// --- Tool registration helpers ---

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register all search/fetch provider tools on an MCP server instance.
 */
export function registerAllTools(server: McpServer, providers: ProviderInstances): void {
  server.registerTool("search_tavily", {
    title: tavilyDef.title,
    description: tavilyDef.description,
    inputSchema: tavilyDef.inputSchema,
    annotations: tavilyDef.annotations,
  }, providers.tavily.handler);

  server.registerTool("search_exa", {
    title: exaDef.title,
    description: exaDef.description,
    inputSchema: exaDef.inputSchema,
    annotations: exaDef.annotations,
  }, providers.exa.handler);

  server.registerTool("search_perplexity", {
    title: pplxDef.title,
    description: pplxDef.description,
    inputSchema: pplxDef.inputSchema,
    annotations: pplxDef.annotations,
  }, providers.perplexity.handler);

  server.registerTool("fetch_jina_markdown", {
    title: jinaDef.title,
    description: jinaDef.description,
    inputSchema: jinaDef.inputSchema,
    annotations: jinaDef.annotations,
  }, providers.jina.handler);

  server.registerTool("fetch_as_markdown", {
    title: cfDef.title,
    description: cfDef.description,
    inputSchema: cfDef.inputSchema,
    annotations: cfDef.annotations,
  }, providers.cloudflare.handler);
}
