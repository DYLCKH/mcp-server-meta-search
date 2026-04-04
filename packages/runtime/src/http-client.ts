import { HttpProviderError, RETRYABLE_HTTP_STATUS } from "@meta-search/shared";
import type { KeySelection } from "./key-pool.js";
import { KeyPool } from "./key-pool.js";

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
