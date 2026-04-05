import { HttpProviderError, RETRYABLE_HTTP_STATUS } from "@meta-search/shared";
import type { KeySelection } from "./key-pool.js";
import { KeyPool } from "./key-pool.js";
import type { ResultCache } from "./perf/cache.js";
import type { ConcurrencyLimiter } from "./perf/concurrency.js";
import type { SingleFlight } from "./perf/single-flight.js";
import type { CircuitBreaker } from "./perf/circuit-breaker.js";
import type { MetricsCollector } from "./perf/metrics.js";

export interface FetchResponse {
  ok: boolean;
  status: number;
  rawText: string;
  json: unknown;
}

export async function fetchResponseWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<FetchResponse> {
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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function defaultExtractSuccessData(response: FetchResponse): unknown {
  return response.json ?? response.rawText;
}

export type ExtractDataFn = (response: FetchResponse) => unknown;

export interface SingleRequestOpts {
  providerName: string;
  timeoutMs: number;
  buildRequest: () => { url: string; init: RequestInit };
  extractData?: ExtractDataFn;
}

export interface RequestResult {
  data: unknown;
  attempts: number;
}

export async function callSingleRequest(
  opts: SingleRequestOpts,
): Promise<RequestResult> {
  const extractData = opts.extractData ?? defaultExtractSuccessData;
  const request = opts.buildRequest();
  const response = await fetchResponseWithTimeout(
    request.url,
    request.init,
    opts.timeoutMs,
  );

  if (!response.ok) {
    throw new HttpProviderError(
      opts.providerName,
      response.status,
      extractProviderErrorBody(response.rawText, response.json),
    );
  }

  return {
    data: extractData(response),
    attempts: 1,
  };
}

export interface KeyRotationOpts {
  providerName: string;
  keyPool: KeyPool;
  timeoutMs: number;
  configuredMaxAttempts: number;
  buildRequest: (key: unknown) => { url: string; init: RequestInit };
  onKeyRevoked?: (
    providerName: string,
    index: number,
    key: unknown,
    error: Error,
  ) => void;
  extractData?: ExtractDataFn;
}

export async function callWithKeyRotation(
  opts: KeyRotationOpts,
): Promise<RequestResult> {
  const extractData = opts.extractData ?? defaultExtractSuccessData;
  const { providerName, keyPool, timeoutMs, configuredMaxAttempts, buildRequest, onKeyRevoked } = opts;

  if (!keyPool.hasKeys()) {
    throw new Error(
      `${providerName}: no API keys configured. Add keys to config.jsonc.`,
    );
  }

  const triedIndices = new Set<number>();
  const dynamicMax =
    configuredMaxAttempts > 0 ? configuredMaxAttempts : keyPool.size();
  const attemptLimit = Math.max(1, Math.min(dynamicMax, keyPool.size()));

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const selected = keyPool.acquire(triedIndices);
    if (!selected) break;

    triedIndices.add(selected.index);

    try {
      const request = buildRequest(selected.key);
      const response = await fetchResponseWithTimeout(
        request.url,
        request.init,
        timeoutMs,
      );

      if (response.ok) {
        keyPool.markSuccess(selected.index);
        return { data: extractData(response), attempts: attempt };
      }

      throw new HttpProviderError(
        providerName,
        response.status,
        extractProviderErrorBody(response.rawText, response.json),
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (
        error instanceof HttpProviderError &&
        isAuthErrorStatus(error.status)
      ) {
        const result = keyPool.disable(selected.index);
        if (result === "revoked" && onKeyRevoked) {
          onKeyRevoked(providerName, selected.index, selected.key, error);
        }
      }

      if (!isRetryableError(error) || attempt >= attemptLimit) {
        if (!keyPool.hasActiveKeys()) {
          throw new Error(
            `${providerName}: all API keys exhausted. Add new keys to config.jsonc.`,
          );
        }
        throw error;
      }
    }
  }

  if (!keyPool.hasActiveKeys()) {
    throw new Error(
      `${providerName}: all API keys exhausted. Add new keys to config.jsonc.`,
    );
  }
  throw lastError ?? new Error(`${providerName}: request failed after ${attemptLimit} attempt(s).`);
}

// ---------------------------------------------------------------------------
// Performance Middleware
// ---------------------------------------------------------------------------

export interface PerfMiddleware {
  cache?: ResultCache;
  limiter?: ConcurrencyLimiter;
  singleFlight?: SingleFlight;
  circuitBreaker?: CircuitBreaker;
  metrics?: MetricsCollector;
}

export interface CallWithPerfOpts extends KeyRotationOpts {
  perf?: PerfMiddleware;
  cacheKey?: string;
}

export async function callWithPerf(opts: CallWithPerfOpts): Promise<RequestResult> {
  const { perf, cacheKey, ...rotationOpts } = opts;
  const providerName = rotationOpts.providerName;
  const tool = rotationOpts.providerName;

  // Without perf middleware, just delegate directly
  if (!perf) {
    return callWithKeyRotation(rotationOpts);
  }

  const start = performance.now();

  // 1. Cache check
  if (perf.cache && cacheKey) {
    const cached = perf.cache.get(cacheKey);
    if (cached.hit) {
      perf.metrics?.recordCacheHit(true);
      perf.metrics?.recordRequest(
        providerName,
        tool,
        performance.now() - start,
        "success",
      );
      return cached.data as RequestResult;
    }
    perf.metrics?.recordCacheHit(false);
  }

  // 2. Circuit breaker check
  if (perf.circuitBreaker) {
    return perf.circuitBreaker.execute(() =>
      callWithPerfInner(opts, providerName, tool, start),
    );
  }

  return callWithPerfInner(opts, providerName, tool, start);
}

async function callWithPerfInner(
  opts: CallWithPerfOpts,
  providerName: string,
  tool: string,
  start: number,
): Promise<RequestResult> {
  const { perf, cacheKey, ...rotationOpts } = opts;
  if (!perf) return callWithKeyRotation(rotationOpts);

  // 3. Single-flight dedup
  const sfKey = cacheKey ?? `${providerName}:${Date.now()}:${Math.random()}`;
  const exec = () => callWithPerfCore(opts, providerName, tool, start);

  if (perf.singleFlight) {
    return perf.singleFlight.dedup(sfKey, exec);
  }

  return exec();
}

async function callWithPerfCore(
  opts: CallWithPerfOpts,
  providerName: string,
  tool: string,
  start: number,
): Promise<RequestResult> {
  const { perf, cacheKey, ...rotationOpts } = opts;
  if (!perf) return callWithKeyRotation(rotationOpts);

  // 4. Acquire concurrency slot
  let release: (() => void) | undefined;
  if (perf.limiter) {
    release = await perf.limiter.acquire();
  }

  try {
    const result = await callWithKeyRotation(rotationOpts);

    // Cache result on success
    if (perf.cache && cacheKey) {
      perf.cache.set(cacheKey, result);
    }

    perf.metrics?.recordRequest(providerName, tool, performance.now() - start, "success");
    return result;
  } catch (error) {
    perf.metrics?.recordRequest(providerName, tool, performance.now() - start, "error");
    throw error;
  } finally {
    release?.();
  }
}

const AUTH_ERROR_STATUSES = new Set([401, 402, 403]);

function isAuthErrorStatus(status: number): boolean {
  return AUTH_ERROR_STATUSES.has(status);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpProviderError) {
    return RETRYABLE_HTTP_STATUS.has(error.status);
  }

  if (error && typeof error === "object") {
    if ((error as Error).name === "AbortError") return true;

    const code =
      typeof (error as NodeJS.ErrnoException).code === "string"
        ? (error as NodeJS.ErrnoException).code!.toUpperCase()
        : "";

    if (
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN"
    ) {
      return true;
    }
  }

  return false;
}

function extractProviderErrorBody(rawText: string, json: unknown): string {
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (obj.detail && typeof (obj.detail as Record<string, unknown>).error === "string") {
      return (obj.detail as Record<string, unknown>).error as string;
    }
    return JSON.stringify(json, null, 2);
  }

  if (typeof rawText === "string" && rawText.trim()) {
    return rawText.trim();
  }

  return "No error payload returned by provider";
}
