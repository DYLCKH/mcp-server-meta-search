#!/usr/bin/env node

import process from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration: JSONC (config.jsonc) with env var overrides
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal JSONC parser — strips // line comments then delegates to JSON.parse.
 * Only supports // line comments (not block comments).
 * Handles quoted strings correctly (won't strip // inside strings like URLs).
 */
function parseJsonc(text) {
  const lines = text.split(/\r?\n/);
  const cleaned = lines.map((line) => {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
        inString = !inString;
      } else if (!inString && ch === "/" && line[i + 1] === "/") {
        return line.slice(0, i);
      }
    }
    return line;
  });
  return JSON.parse(cleaned.join("\n"));
}

function loadConfigFromFile() {
  try {
    const raw = readFileSync(join(__dirname, "config.jsonc"), "utf-8");
    return parseJsonc(raw);
  } catch {
    return null;
  }
}

/**
 * Apply environment variable overrides to config object.
 * Mapping: double-underscore separates nesting levels, all lowercased.
 *   TAVILY__API_KEYS → config.tavily.api_keys
 *   CLOUDFLARE__BASE_URL → config.cloudflare.base_url
 * Values are JSON.parse'd if possible, otherwise kept as strings.
 */
function applyEnvOverrides(config) {
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.includes("__") || envVal === undefined) continue;

    const segments = envKey.toLowerCase().split("__");
    let target = config;
    for (let i = 0; i < segments.length - 1; i++) {
      if (target[segments[i]] === undefined || typeof target[segments[i]] !== "object") {
        target[segments[i]] = {};
      }
      target = target[segments[i]];
    }

    const leafKey = segments.at(-1);
    let parsed;
    try { parsed = JSON.parse(envVal); } catch { parsed = envVal; }
    target[leafKey] = parsed;
  }
  return config;
}

/**
 * @deprecated — .env format is deprecated. Auto-migrates .env → config.jsonc.
 * Will be removed in a future version.
 */
function migrateEnvToJsonc() {
  const envPath = join(__dirname, ".env");
  const jsoncPath = join(__dirname, "config.jsonc");

  if (!existsSync(envPath) || existsSync(jsoncPath)) return null;

  let envContent;
  try { envContent = readFileSync(envPath, "utf-8"); } catch { return null; }

  // Parse .env key-value pairs
  const envPairs = {};
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) envPairs[key] = val;
  }

  // Build config object from .env pairs
  const cfg = {};

  // Helper: parse comma-separated keys (reuse logic from parseApiKeys)
  const splitKeys = (...values) => {
    const combined = values.filter(v => typeof v === "string").join(",");
    return [...new Set(combined.split(/[\n,;]+/g).map(s => s.trim()).filter(Boolean))];
  };

  // Tavily
  const tavilyK = splitKeys(envPairs.TAVILY_API_KEYS, envPairs.TAVILY_API_KEY);
  if (tavilyK.length || envPairs.TAVILY_BASE_URL) {
    cfg.tavily = {};
    if (tavilyK.length) cfg.tavily.api_keys = tavilyK;
    if (envPairs.TAVILY_BASE_URL) cfg.tavily.base_url = envPairs.TAVILY_BASE_URL;
  }

  // Exa
  const exaK = splitKeys(envPairs.EXA_API_KEYS, envPairs.EXA_API_KEY);
  if (exaK.length || envPairs.EXA_BASE_URL) {
    cfg.exa = {};
    if (exaK.length) cfg.exa.api_keys = exaK;
    if (envPairs.EXA_BASE_URL) cfg.exa.base_url = envPairs.EXA_BASE_URL;
  }

  // Perplexity
  const pplxK = splitKeys(envPairs.PERPLEXITY_API_KEYS, envPairs.PERPLEXITY_API_KEY);
  if (pplxK.length || envPairs.PERPLEXITY_BASE_URL) {
    cfg.perplexity = {};
    if (pplxK.length) cfg.perplexity.api_keys = pplxK;
    if (envPairs.PERPLEXITY_BASE_URL) cfg.perplexity.base_url = envPairs.PERPLEXITY_BASE_URL;
  }

  // Cloudflare
  const cfIds = splitKeys(envPairs.CLOUDFLARE_ACCOUNT_IDS, envPairs.CLOUDFLARE_ACCOUNT_ID);
  const cfTokens = splitKeys(envPairs.CLOUDFLARE_API_TOKENS, envPairs.CLOUDFLARE_API_TOKEN);
  const cfCount = Math.min(cfIds.length, cfTokens.length);
  if (cfCount > 0 || envPairs.CLOUDFLARE_BASE_URL) {
    cfg.cloudflare = {};
    if (cfCount > 0) {
      cfg.cloudflare.accounts = [];
      for (let i = 0; i < cfCount; i++) {
        cfg.cloudflare.accounts.push({ account_id: cfIds[i], api_token: cfTokens[i] });
      }
    }
    if (envPairs.CLOUDFLARE_BASE_URL) cfg.cloudflare.base_url = envPairs.CLOUDFLARE_BASE_URL;
  }

  // Global settings
  if (envPairs.SEARCH_KEY_ROTATION_STRATEGY) cfg.key_rotation_strategy = envPairs.SEARCH_KEY_ROTATION_STRATEGY;
  if (envPairs.SEARCH_MAX_ATTEMPTS_PER_REQUEST) cfg.max_attempts_per_request = Number.parseInt(envPairs.SEARCH_MAX_ATTEMPTS_PER_REQUEST, 10);
  if (envPairs.SEARCH_REQUEST_TIMEOUT_MS) cfg.request_timeout_ms = Number.parseInt(envPairs.SEARCH_REQUEST_TIMEOUT_MS, 10);

  // Write config.jsonc
  const lines = [
    "// Auto-migrated from .env — please review and customize",
    "// @deprecated: .env auto-migration will be removed in a future version",
    JSON.stringify(cfg, null, 2),
  ];
  writeFileSync(jsoncPath, lines.join("\n"), "utf-8");
  process.stderr.write("[web-search] Auto-migrated .env -> config.jsonc (review recommended)\n");
  return cfg;
}

function resolveConfig() {
  let config = loadConfigFromFile();
  if (!config) {
    config = migrateEnvToJsonc();
  }
  if (!config) {
    config = {};
  }
  applyEnvOverrides(config);
  return config;
}

const config = resolveConfig();

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
    super(HttpProviderError.briefMessage(provider, status));
    this.name = "HttpProviderError";
    this.provider = provider;
    this.status = status;
    this.body = body;
  }

  /** Return a short, agent-friendly error message based on HTTP status. */
  static briefMessage(provider, status) {
    switch (status) {
      case 401: return `${provider}: invalid API key. Replace or remove it.`;
      case 402: return `${provider}: payment required — billing issue or quota exceeded.`;
      case 403: return `${provider}: access denied. Check token permissions.`;
      case 429: return `${provider}: rate limited. Try again later.`;
      case 408: return `${provider}: request timed out. Try again.`;
      case 500: case 502: case 503: case 504:
        return `${provider}: service temporarily unavailable (${status}). Try again later.`;
      default:
        return `${provider}: request failed (HTTP ${status}).`;
    }
  }
}

const AUTH_ERROR_STATUSES = new Set([401, 402, 403]);

class KeyPool {
  /**
   * @param {string} providerName
   * @param {any[]} keys - opaque key values (strings or objects)
   * @param {string} strategy - "round_robin" or "random"
   * @param {object} healthOpts
   * @param {number} healthOpts.recoveryIntervalMs - ms before disabled → active
   * @param {number} healthOpts.maxDisableBeforeRevoke - cumulative disable count to trigger revoke
   */
  constructor(providerName, keys, strategy, healthOpts = {}) {
    this.providerName = providerName;
    this.keys = keys;
    this.strategy = strategy === "random" ? "random" : "round_robin";
    this.nextIndex = 0;
    this.recoveryIntervalMs = healthOpts.recoveryIntervalMs ?? 300_000;
    this.maxDisableBeforeRevoke = healthOpts.maxDisableBeforeRevoke ?? 3;

    // Per-key health state
    this.keyState = keys.map(() => ({
      status: "active",    // "active" | "disabled" | "revoked"
      disableCount: 0,     // cumulative — never resets
      disabledAt: null,    // timestamp of last disable
    }));
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  hasActiveKeys() {
    return this.keyState.some((s) => s.status === "active");
  }

  size() {
    return this.keys.length;
  }

  activeSize() {
    return this.keyState.filter((s) => s.status === "active").length;
  }

  acquire(triedIndices) {
    if (!this.hasKeys()) return null;

    const now = Date.now();
    const available = [];

    for (let index = 0; index < this.keys.length; index++) {
      if (triedIndices.has(index)) continue;

      const state = this.keyState[index];
      if (state.status === "revoked") continue;

      if (state.status === "disabled") {
        if (
          this.recoveryIntervalMs > 0 &&
          state.disabledAt &&
          now - state.disabledAt >= this.recoveryIntervalMs
        ) {
          state.status = "active";
          process.stderr.write(
            `[web-search] Key #${index} for ${this.providerName} recovered ` +
            `(disable count: ${state.disableCount}/${this.maxDisableBeforeRevoke})\n`,
          );
        } else {
          continue;
        }
      }

      available.push(index);
    }

    if (available.length === 0) return null;

    let selectedIndex;
    if (this.strategy === "random") {
      selectedIndex = available[Math.floor(Math.random() * available.length)];
    } else {
      selectedIndex = available.find((i) => i >= this.nextIndex) ?? available[0];
    }

    return { index: selectedIndex, key: this.keys[selectedIndex] };
  }

  markSuccess(index) {
    if (!this.hasKeys()) return;
    this.nextIndex = (index + 1) % this.keys.length;
  }

  /**
   * Mark a key as disabled due to auth failure.
   * @returns {"disabled"|"revoked"} the resulting status
   */
  disable(index) {
    const state = this.keyState[index];
    if (!state || state.status === "revoked") return "revoked";

    state.disableCount += 1;
    state.disabledAt = Date.now();

    if (state.disableCount >= this.maxDisableBeforeRevoke) {
      state.status = "revoked";
      return "revoked";
    }

    state.status = "disabled";
    return "disabled";
  }
}

// ---------------------------------------------------------------------------
// Invalid key tracking — persist revoked keys to a local JSON file
// ---------------------------------------------------------------------------

function maskKey(key) {
  if (typeof key === "string") {
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "..." + key.slice(-4);
  }
  if (key && typeof key === "object") {
    const masked = {};
    for (const [k, v] of Object.entries(key)) {
      masked[k] = typeof v === "string" ? maskKey(v) : "****";
    }
    return masked;
  }
  return "****";
}

function loadInvalidKeys(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createKeyRevokedHandler(invalidKeysFilePath) {
  const revokedKeys = loadInvalidKeys(invalidKeysFilePath);

  return function onKeyRevoked(providerName, index, key, error) {
    const entry = {
      provider: providerName,
      key_index: index,
      key_hint: maskKey(key),
      error_status: error instanceof HttpProviderError ? error.status : null,
      error_message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      revoked_at: new Date().toISOString(),
    };

    revokedKeys.push(entry);
    try {
      writeFileSync(invalidKeysFilePath, JSON.stringify(revokedKeys, null, 2), "utf-8");
    } catch (writeErr) {
      process.stderr.write(`[web-search] Failed to write invalid keys file: ${writeErr.message}\n`);
    }
    process.stderr.write(
      `[web-search] Key #${index} for ${providerName} permanently revoked ` +
      `(written to ${invalidKeysFilePath})\n`,
    );
  };
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
  onKeyRevoked,
}) {
  if (!keyPool.hasKeys()) {
    throw new Error(
      `${providerName}: no API keys configured. Add keys to config.jsonc.`,
    );
  }

  const triedIndices = new Set();
  const dynamicMax =
    configuredMaxAttempts > 0 ? configuredMaxAttempts : keyPool.size();
  const attemptLimit = Math.max(1, Math.min(dynamicMax, keyPool.size()));

  let lastError = null;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const selected = keyPool.acquire(triedIndices);
    if (!selected) break;

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
        return { data: response.json ?? response.rawText, attempts: attempt };
      }

      throw new HttpProviderError(
        providerName,
        response.status,
        extractProviderErrorBody(response.rawText, response.json),
      );
    } catch (error) {
      lastError = error;

      // Auth error → disable key, possibly revoke
      if (error instanceof HttpProviderError && AUTH_ERROR_STATUSES.has(error.status)) {
        const result = keyPool.disable(selected.index);
        if (result === "revoked" && onKeyRevoked) {
          onKeyRevoked(providerName, selected.index, selected.key, error);
        }
      }

      if (!isRetryableError(error) || attempt >= attemptLimit) {
        // If all active keys are now gone, give a clear message
        if (!keyPool.hasActiveKeys()) {
          throw new Error(
            `${providerName}: all API keys exhausted. Add new keys to config.jsonc.`,
          );
        }
        throw error;
      }
    }
  }

  // Fallback — all attempts consumed
  if (!keyPool.hasActiveKeys()) {
    throw new Error(
      `${providerName}: all API keys exhausted. Add new keys to config.jsonc.`,
    );
  }
  throw lastError ?? new Error(`${providerName}: request failed after ${attemptLimit} attempt(s).`);
}

function normalizeResults(results) {
  return Array.isArray(results) ? results : [];
}

// ---------------------------------------------------------------------------
// Resolve configuration into runtime values
// ---------------------------------------------------------------------------

const keyRotationStrategy =
  config.key_rotation_strategy === "random" ? "random" : "round_robin";

const requestTimeoutMs = parsePositiveInt(config.request_timeout_ms, DEFAULT_TIMEOUT_MS);
const maxAttemptsPerRequest = parsePositiveInt(config.max_attempts_per_request, 0);

// Key health settings
const keyRecoveryIntervalMs = parsePositiveInt(config.key_recovery_interval_ms, 300_000);
const maxDisableBeforeRevoke = parsePositiveInt(config.max_disable_before_revoke, 3);
const invalidKeysFile = config.invalid_keys_file || "invalid-keys.json";
const invalidKeysPath = join(__dirname, invalidKeysFile);
const onKeyRevoked = createKeyRevokedHandler(invalidKeysPath);

const healthOpts = {
  recoveryIntervalMs: keyRecoveryIntervalMs,
  maxDisableBeforeRevoke,
};

const tavilyBaseUrl = normalizeBaseUrl(config.tavily?.base_url, "https://api.tavily.com");
const tavilyKeyPool = new KeyPool(
  "tavily",
  Array.isArray(config.tavily?.api_keys) ? config.tavily.api_keys : [],
  keyRotationStrategy,
  healthOpts,
);

const exaBaseUrl = normalizeBaseUrl(config.exa?.base_url, "https://api.exa.ai");
const exaKeyPool = new KeyPool(
  "exa",
  Array.isArray(config.exa?.api_keys) ? config.exa.api_keys : [],
  keyRotationStrategy,
  healthOpts,
);

const perplexityBaseUrl = normalizeBaseUrl(config.perplexity?.base_url, "https://api.perplexity.ai");
const perplexityKeyPool = new KeyPool(
  "perplexity",
  Array.isArray(config.perplexity?.api_keys) ? config.perplexity.api_keys : [],
  keyRotationStrategy,
  healthOpts,
);

const cfBaseUrl = normalizeBaseUrl(config.cloudflare?.base_url, "https://api.cloudflare.com/client/v4");
const cfCredentials = Array.isArray(config.cloudflare?.accounts)
  ? config.cloudflare.accounts.map((a) => ({
      accountId: a.account_id,
      token: a.api_token,
    }))
  : [];
const cfKeyPool = new KeyPool("cloudflare", cfCredentials, keyRotationStrategy, healthOpts);

const server = new McpServer({
  name: "web-search",
  version: "1.1.0",
});

server.registerTool(
  "search_tavily",
  {
    title: "Tavily Search (Key Rotation)",
    description:
      "Perform web search via Tavily. Best for general search with structured output and built-in answer generation.",
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
      ),
      include_raw_content: z.preprocess(
        coerceBoolOrEnum,
        z.union([z.boolean(), z.enum(["markdown", "text"])]).optional(),
      ),
      include_images: z.preprocess(coerceBool, z.boolean().optional()),
      include_image_descriptions: z.preprocess(coerceBool, z.boolean().optional()),
      include_favicon: z.preprocess(coerceBool, z.boolean().optional()),
      auto_parameters: z.preprocess(coerceBool, z.boolean().optional()),
      include_usage: z.preprocess(coerceBool, z.boolean().optional()),
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
      onKeyRevoked,
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
      "Perform web search via Exa. Best for semantic search, finding similar content, people/company lookups, and research papers.",
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
      user_location: z.string().length(2).optional(),
      include_domains: z.array(z.string().min(1)).max(1200).optional().describe("List of domains to include in the search. If specified, results will only come from these domains"),
      exclude_domains: z.array(z.string().min(1)).max(1200).optional().describe("List of domains to exclude from search results. If specified, no results will be returned from these domains"),
      start_crawl_date: z.string().optional(),
      end_crawl_date: z.string().optional(),
      start_published_date: z.string().optional().describe("Only links with a published date after this will be returned. Must be in ISO 8601 format"),
      end_published_date: z.string().optional().describe("Only links with a published date before this will be returned. Must be in ISO 8601 format"),
      include_text: z.preprocess(coerceBool, z.boolean().optional()),
      include_highlights: z.preprocess(coerceBool, z.boolean().optional()),
      include_summary: z.preprocess(coerceBool, z.boolean().optional()),
      summary_query: z.string().optional(),
      max_age_hours: z.preprocess(coerceInt, z.number().int().optional()),
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
      onKeyRevoked,
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
      "Perform web search via Perplexity. Best for AI-synthesized answers with inline citations and high factuality.",
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
      onKeyRevoked,
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

server.registerTool(
  "fetch_as_markdown",
  {
    title: "Fetch as Markdown (Cloudflare Browser Rendering)",
    description:
      "Fetches a URL via Cloudflare Browser Rendering and converts to Markdown. " +
      "NOT the first choice — prefer other fetch tools; use only when they fail or JS rendering is required.",
    inputSchema: {
      url: z
        .string()
        .min(1)
        .describe("The URL of the webpage to convert to Markdown."),
      html: z
        .string()
        .optional()
        .describe(
          "Raw HTML to convert directly (alternative to url). When provided, url is ignored by the API.",
        ),
      cacheTTL: z
        .preprocess(coerceInt, z.number().int().min(0).max(86400).optional())
        .describe(
          "Cache TTL in seconds (0 to disable, max 86400). Default: 5. Passed as query parameter.",
        ),
      gotoOptions: z
        .object({
          waitUntil: z
            .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
            .optional()
            .describe(
              "When to consider navigation complete. Use 'networkidle0' or 'networkidle2' for JS-heavy pages.",
            ),
          timeout: z
            .preprocess(
              coerceInt,
              z.number().int().min(0).max(60000).optional(),
            )
            .describe("Max navigation time in ms (max 60000)."),
        })
        .optional()
        .describe("Navigation options controlling page load behavior."),
      waitForSelector: z
        .object({
          selector: z
            .string()
            .min(1)
            .describe("CSS selector to wait for before extraction."),
          visible: z
            .preprocess(coerceBool, z.boolean().optional())
            .describe("Wait until element is visible."),
          hidden: z
            .preprocess(coerceBool, z.boolean().optional())
            .describe("Wait until element is hidden."),
          timeout: z
            .preprocess(
              coerceInt,
              z.number().int().min(0).max(60000).optional(),
            )
            .describe("Max wait time for selector in ms."),
        })
        .optional()
        .describe("Wait for a specific CSS selector before extraction."),
      rejectRequestPattern: z
        .array(z.string())
        .optional()
        .describe(
          'Regex patterns for request URLs to block (e.g. ["/^.*\\\\.(css)/"]).',
        ),
      rejectResourceTypes: z
        .array(z.string())
        .optional()
        .describe('Resource types to block (e.g. ["image", "stylesheet"]).'),
      allowRequestPattern: z
        .array(z.string())
        .optional()
        .describe("Regex patterns for allowed request URLs (whitelist)."),
      allowResourceTypes: z
        .array(z.string())
        .optional()
        .describe("Resource types to allow (whitelist)."),
      cookies: z
        .array(
          z.object({
            name: z.string().describe("Cookie name."),
            value: z.string().describe("Cookie value."),
            domain: z.string().optional().describe("Cookie domain."),
            path: z.string().optional().describe("Cookie path."),
            secure: z
              .preprocess(coerceBool, z.boolean().optional())
              .describe("Secure flag."),
            httpOnly: z
              .preprocess(coerceBool, z.boolean().optional())
              .describe("HttpOnly flag."),
          }),
        )
        .optional()
        .describe("Cookies to set before navigation."),
      authenticate: z
        .object({
          username: z.string().describe("HTTP Basic Auth username."),
          password: z.string().describe("HTTP Basic Auth password."),
        })
        .optional()
        .describe("HTTP Basic Auth credentials."),
      setExtraHTTPHeaders: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Custom HTTP headers as key-value pairs (e.g. {"Authorization": "Bearer token"}).',
        ),
      viewport: z
        .object({
          width: z
            .preprocess(coerceInt, z.number().int().optional())
            .describe("Viewport width in pixels."),
          height: z
            .preprocess(coerceInt, z.number().int().optional())
            .describe("Viewport height in pixels."),
          deviceScaleFactor: z
            .preprocess(coerceNum, z.number().optional())
            .describe("Device scale factor (DPR)."),
        })
        .optional()
        .describe("Browser viewport dimensions."),
      userAgent: z
        .string()
        .optional()
        .describe("Custom User-Agent string for the request."),
      addScriptTag: z
        .array(
          z.object({
            content: z
              .string()
              .optional()
              .describe("Inline JavaScript code."),
            url: z
              .string()
              .optional()
              .describe("URL to external JS file."),
          }),
        )
        .optional()
        .describe("JavaScript tags to inject before rendering."),
      addStyleTag: z
        .array(
          z.object({
            content: z.string().optional().describe("Inline CSS rules."),
            url: z
              .string()
              .optional()
              .describe("URL to external CSS file."),
          }),
        )
        .optional()
        .describe("CSS tags to inject before rendering."),
      setJavaScriptEnabled: z
        .preprocess(coerceBool, z.boolean().optional())
        .describe("Enable/disable JavaScript execution (default: true)."),
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  async (input) => {
    if (!cfKeyPool.hasKeys()) {
      throw new Error(
        "cloudflare: no credentials configured. Add accounts to config.jsonc.",
      );
    }

    const queryParams =
      input.cacheTTL !== undefined ? `?cacheTTL=${input.cacheTTL}` : "";

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
      keyPool: cfKeyPool,
      timeoutMs: requestTimeoutMs,
      configuredMaxAttempts: maxAttemptsPerRequest,
      onKeyRevoked,
      buildRequest: (cred) => ({
        url: `${cfBaseUrl}/accounts/${cred.accountId}/browser-rendering/markdown${queryParams}`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cred.token}`,
          },
          body: JSON.stringify(payload),
        },
      }),
    });

    // Cloudflare response envelope: { success: true, result: "markdown string" }
    const response = data && typeof data === "object" ? data : {};
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
      content: [
        {
          type: "text",
          text: markdown || stringifyForToolContent(normalized),
        },
      ],
      structuredContent: normalized,
    };
  },
);

async function main() {
  // Startup summary
  const providers = [
    { name: "Tavily", pool: tavilyKeyPool },
    { name: "Exa", pool: exaKeyPool },
    { name: "Perplexity", pool: perplexityKeyPool },
    { name: "Cloudflare", pool: cfKeyPool },
  ];

  process.stderr.write("[web-search] Starting up...\n");
  for (const { name, pool } of providers) {
    const count = pool.size();
    const status = count > 0 ? `${count} key(s)` : "not configured";
    process.stderr.write(`[web-search]   ${name}: ${status}\n`);
  }
  process.stderr.write(
    `[web-search]   Strategy: ${keyRotationStrategy} | ` +
    `Timeout: ${requestTimeoutMs}ms | ` +
    `Recovery: ${keyRecoveryIntervalMs}ms | ` +
    `Max disable: ${maxDisableBeforeRevoke}\n`,
  );
  process.stderr.write("[web-search] Ready.\n");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[web-search] ${message}\n`);
  process.exit(1);
});
