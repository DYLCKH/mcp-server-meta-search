#!/usr/bin/env node

import process from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 从脚本同目录加载 .env（不覆盖已有环境变量）
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envContent = readFileSync(join(__dirname, ".env"), "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // 去除引号包裹
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
} catch {
  // .env 不存在则静默跳过
}

// 让 Node.js 内置 fetch（undici）走系统代理
// Node.js 的 fetch 不会自动读取 https_proxy 环境变量，需手动设置 global dispatcher
try {
  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;
  if (proxyUrl) {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }
} catch {
  // undici 不可用则静默跳过，fetch 继续直连
}

const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_HTTP_STATUS = new Set([
  401,
  402,
  403,
  408,
  409,
  425,
  429,
  432,
  433,
  500,
  502,
  503,
  504,
]);

function normalizeBaseUrl(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseApiKeys(manyKeysValue, singleKeyValue) {
  const combined = [manyKeysValue, singleKeyValue]
    .filter((value) => typeof value === "string")
    .join(",");

  const chunks = combined
    .split(/[\n,;]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  return [...new Set(chunks)];
}

function compactObject(object) {
  const compacted = {};

  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }

  return compacted;
}

// --- 类型强制转换辅助 ---
// 某些 LLM / MCP client 会把 boolean/number 序列化为字符串，
// 在 Zod schema 验证之前做预处理以提高兼容性。

function coerceBool(v) {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return v; // 保留原值让 Zod 继续校验
}

function coerceInt(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return v;
}

function coerceNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/** 对 boolean | enum 联合类型：先尝试 coerce boolean，否则保留原值（可能是 enum 字符串） */
function coerceBoolOrEnum(v) {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return v; // 可能是 "basic"/"advanced" 等 enum 值
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringifyForToolContent(value) {
  return JSON.stringify(value, null, 2);
}

class HttpProviderError extends Error {
  constructor(provider, status, body) {
    const bodyText =
      typeof body === "string" && body.trim()
        ? body.trim().slice(0, 600)
        : "No error payload returned by provider";
    super(`${provider} API request failed (${status}): ${bodyText}`);
    this.name = "HttpProviderError";
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

class KeyPool {
  constructor(providerName, keys, strategy) {
    this.providerName = providerName;
    this.keys = keys;
    this.strategy = strategy === "random" ? "random" : "round_robin";
    this.nextIndex = 0;
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  size() {
    return this.keys.length;
  }

  acquire(triedIndices) {
    if (!this.hasKeys()) {
      return null;
    }

    const available = [];
    for (let index = 0; index < this.keys.length; index += 1) {
      if (!triedIndices.has(index)) {
        available.push(index);
      }
    }

    if (available.length === 0) {
      return null;
    }

    let selectedIndex;

    if (this.strategy === "random") {
      selectedIndex = available[Math.floor(Math.random() * available.length)];
    } else {
      selectedIndex = available.find((index) => index >= this.nextIndex);
      if (selectedIndex === undefined) {
        selectedIndex = available[0];
      }
    }

    return {
      index: selectedIndex,
      key: this.keys[selectedIndex],
    };
  }

  markSuccess(index) {
    if (!this.hasKeys()) {
      return;
    }

    this.nextIndex = (index + 1) % this.keys.length;
  }
}

function isRetryableError(error) {
  if (error instanceof HttpProviderError) {
    return RETRYABLE_HTTP_STATUS.has(error.status);
  }

  if (error && typeof error === "object") {
    if (error.name === "AbortError") {
      return true;
    }

    const networkCode =
      typeof error.code === "string" ? error.code.toUpperCase() : "";

    if (
      networkCode === "ETIMEDOUT" ||
      networkCode === "ECONNRESET" ||
      networkCode === "ENOTFOUND" ||
      networkCode === "EAI_AGAIN"
    ) {
      return true;
    }
  }

  return false;
}

function extractProviderErrorBody(rawText, jsonBody) {
  if (jsonBody && typeof jsonBody === "object") {
    if (typeof jsonBody.error === "string") {
      return jsonBody.error;
    }

    if (jsonBody.detail && typeof jsonBody.detail.error === "string") {
      return jsonBody.detail.error;
    }

    return stringifyForToolContent(jsonBody);
  }

  if (typeof rawText === "string" && rawText.trim()) {
    return rawText.trim();
  }

  return "No error payload returned by provider";
}

async function fetchJsonWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const rawText = await response.text();
    const json = safeJsonParse(rawText);

    return {
      ok: response.ok,
      status: response.status,
      rawText,
      json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callWithKeyRotation({
  providerName,
  keyPool,
  timeoutMs,
  configuredMaxAttempts,
  buildRequest,
}) {
  if (!keyPool.hasKeys()) {
    throw new Error(
      `${providerName.toUpperCase()} API keys are missing. Configure ${providerName.toUpperCase()}_API_KEYS or ${providerName.toUpperCase()}_API_KEY.`,
    );
  }

  const triedIndices = new Set();
  const dynamicMax =
    configuredMaxAttempts > 0 ? configuredMaxAttempts : keyPool.size();
  const attemptLimit = Math.max(1, Math.min(dynamicMax, keyPool.size()));

  let lastError = null;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const selected = keyPool.acquire(triedIndices);
    if (!selected) {
      break;
    }

    triedIndices.add(selected.index);

    try {
      const request = buildRequest(selected.key);
      const response = await fetchJsonWithTimeout(
        request.url,
        request.init,
        timeoutMs,
      );

      if (response.ok) {
        keyPool.markSuccess(selected.index);
        return {
          data: response.json ?? response.rawText,
          attempts: attempt,
        };
      }

      throw new HttpProviderError(
        providerName,
        response.status,
        extractProviderErrorBody(response.rawText, response.json),
      );
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt >= attemptLimit) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(`${providerName} request failed`);
}

function normalizeResults(results) {
  return Array.isArray(results) ? results : [];
}

const keyRotationStrategy =
  process.env.SEARCH_KEY_ROTATION_STRATEGY === "random"
    ? "random"
    : "round_robin";

const requestTimeoutMs = parsePositiveInt(
  process.env.SEARCH_REQUEST_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);

const maxAttemptsPerRequest = parsePositiveInt(
  process.env.SEARCH_MAX_ATTEMPTS_PER_REQUEST,
  0,
);

const tavilyBaseUrl = normalizeBaseUrl(
  process.env.TAVILY_BASE_URL,
  "https://api.tavily.com",
);

const exaBaseUrl = normalizeBaseUrl(process.env.EXA_BASE_URL, "https://api.exa.ai");

const perplexityBaseUrl = normalizeBaseUrl(
  process.env.PERPLEXITY_BASE_URL,
  "https://api.perplexity.ai",
);

const tavilyKeyPool = new KeyPool(
  "tavily",
  parseApiKeys(process.env.TAVILY_API_KEYS, process.env.TAVILY_API_KEY),
  keyRotationStrategy,
);

const exaKeyPool = new KeyPool(
  "exa",
  parseApiKeys(process.env.EXA_API_KEYS, process.env.EXA_API_KEY),
  keyRotationStrategy,
);

const perplexityKeyPool = new KeyPool(
  "perplexity",
  parseApiKeys(
    process.env.PERPLEXITY_API_KEYS,
    process.env.PERPLEXITY_API_KEY,
  ),
  keyRotationStrategy,
);

const server = new McpServer({
  name: "search-rotator",
  version: "1.1.0",
});

server.registerTool(
  "search_tavily",
  {
    title: "Tavily Search (Key Rotation)",
    description:
      "Execute a web search via Tavily; automatically rotates API keys on auth failure, rate-limiting, or transient errors.",
    inputSchema: {
      query: z.string().min(1).describe("The search query to execute with Tavily."),
      max_results: z.preprocess(coerceInt, z.number().int().min(1).max(20).optional()).describe("The maximum number of search results to return (1-20, default 5)."),
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
      include_answer: z.preprocess(
        coerceBoolOrEnum,
        z.union([z.boolean(), z.enum(["basic", "advanced"])]).optional(),
      ).describe("Include an LLM-generated answer. 'basic' or true returns a quick answer, 'advanced' returns a more detailed answer."),
      include_raw_content: z.preprocess(
        coerceBoolOrEnum,
        z.union([z.boolean(), z.enum(["markdown", "text"])]).optional(),
      ).describe("Include cleaned and parsed HTML content of each result. 'markdown' or true returns markdown format, 'text' returns plain text (may increase latency)."),
      include_images: z.preprocess(coerceBool, z.boolean().optional()).describe("Also perform an image search and include the results in the response."),
      include_image_descriptions: z.preprocess(coerceBool, z.boolean().optional()).describe("When include_images is true, also add a descriptive text for each image."),
      include_favicon: z.preprocess(coerceBool, z.boolean().optional()).describe("Whether to include the favicon URL for each result."),
      auto_parameters: z.preprocess(coerceBool, z.boolean().optional()).describe("When enabled, Tavily automatically configures search parameters based on query content and intent. Explicit values override automatic ones."),
      include_usage: z.preprocess(coerceBool, z.boolean().optional()).describe("Whether to include credit usage information in the response."),
    },
    annotations: {
      readOnlyHint: true,
    },
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

    const response = data && typeof data === "object" ? data : {};
    const normalized = {
      provider: "tavily",
      attempts,
      request_id:
        typeof response.request_id === "string" ? response.request_id : null,
      query: typeof response.query === "string" ? response.query : input.query,
      answer: typeof response.answer === "string" ? response.answer : null,
      response_time:
        typeof response.response_time === "number"
          ? response.response_time
          : null,
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
  },
);

server.registerTool(
  "search_exa",
  {
    title: "Exa Search (Key Rotation)",
    description:
      "Perform web search via Exa; automatically rotates API keys on auth failure, rate limiting, or transient errors.",
    inputSchema: {
      query: z.string().min(1).describe("The query string for the search"),
      num_results: z.preprocess(coerceInt, z.number().int().min(1).max(100).optional()).describe("Number of results to return (1-100, default 10)"),
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
      user_location: z.string().length(2).optional().describe("Two-letter ISO country code of the user, e.g. US"),
      include_domains: z.array(z.string().min(1)).max(1200).optional().describe("List of domains to include in the search. If specified, results will only come from these domains"),
      exclude_domains: z.array(z.string().min(1)).max(1200).optional().describe("List of domains to exclude from search results. If specified, no results will be returned from these domains"),
      start_crawl_date: z.string().optional().describe("Results will include links crawled after this date. Must be in ISO 8601 format (e.g. 2023-01-01T00:00:00.000Z)"),
      end_crawl_date: z.string().optional().describe("Results will include links crawled before this date. Must be in ISO 8601 format (e.g. 2023-12-31T00:00:00.000Z)"),
      start_published_date: z.string().optional().describe("Only links with a published date after this will be returned. Must be in ISO 8601 format"),
      end_published_date: z.string().optional().describe("Only links with a published date before this will be returned. Must be in ISO 8601 format"),
      include_text: z.preprocess(coerceBool, z.boolean().optional()).describe("If true (default), returns full page text content for each result"),
      include_highlights: z.preprocess(coerceBool, z.boolean().optional()).describe("If true (default), returns text snippets the LLM identifies as most relevant from each page"),
      include_summary: z.preprocess(coerceBool, z.boolean().optional()).describe("If true, returns an LLM-generated summary of each webpage"),
      summary_query: z.string().optional().describe("Custom query to direct the LLM-generated summary content"),
      max_age_hours: z.preprocess(coerceInt, z.number().int().optional()).describe("Maximum age of cached content in hours. Positive value uses cache if fresh enough, 0 always livecrawls, -1 always uses cache, omit for default behavior"),
    },
    annotations: {
      readOnlyHint: true,
    },
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
      buildRequest: (apiKey) => ({
        url: `${exaBaseUrl}/search`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        },
      }),
    });

    const response = data && typeof data === "object" ? data : {};
    const normalized = {
      provider: "exa",
      attempts,
      requestId:
        typeof response.requestId === "string" ? response.requestId : null,
      searchType:
        typeof response.searchType === "string" ? response.searchType : null,
      query: input.query,
      costDollars:
        response.costDollars && typeof response.costDollars === "object"
          ? response.costDollars
          : null,
      results: normalizeResults(response.results),
    };

    return {
      content: [{ type: "text", text: stringifyForToolContent(normalized) }],
      structuredContent: normalized,
    };
  },
);

server.registerTool(
  "search_perplexity",
  {
    title: "Perplexity Search (Key Rotation)",
    description:
      "Perform web search via Perplexity; automatically rotates API keys on auth failure, rate-limiting, or transient errors.",
    inputSchema: {
      query: z.string().min(1).describe("The search query to execute with Perplexity."),
      max_results: z.preprocess(coerceInt, z.number().int().min(1).max(20).optional()).describe("The maximum number of search results to return (1-20, default 10)."),
      max_tokens_per_page: z.preprocess(coerceInt, z.number().int().min(256).max(2048).optional()).describe("Maximum tokens of content to return per result page (256-2048, default 1024)."),
      country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code to bias search results, e.g. US, CN, GB."),
    },
    annotations: {
      readOnlyHint: true,
    },
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
      buildRequest: (apiKey) => ({
        url: `${perplexityBaseUrl}/search`,
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

    const response = data && typeof data === "object" ? data : {};

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
      content: [{ type: "text", text: stringifyForToolContent(normalized) }],
      structuredContent: normalized,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[mcp-search-rotator] ${message}\n`);
  process.exit(1);
});
