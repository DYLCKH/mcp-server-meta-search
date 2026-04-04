import { z } from "zod";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  api_keys?: string[];
  base_url?: string;
}

export interface CloudflareAccount {
  account_id: string;
  api_token: string;
}

export interface CloudflareConfig extends ProviderConfig {
  accounts?: CloudflareAccount[];
}

export interface GlobalSettings {
  key_rotation_strategy?: "round_robin" | "random";
  max_attempts_per_request?: number;
  request_timeout_ms?: number;
  key_recovery_interval_ms?: number;
  max_disable_before_revoke?: number;
  invalid_keys_file?: string;
}

export interface PatRecord {
  name: string;
  prefix: string;
  hash: string;
  encrypted: boolean;
  expires_at: string | null;
  disabled: boolean;
  note: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AppConfig {
  tavily?: ProviderConfig;
  exa?: ProviderConfig;
  perplexity?: ProviderConfig;
  jina?: ProviderConfig;
  cloudflare?: CloudflareConfig;
  settings?: GlobalSettings;
  pats?: PatRecord[];
  // Allow flat access to global settings keys
  key_rotation_strategy?: "round_robin" | "random";
  max_attempts_per_request?: number;
  request_timeout_ms?: number;
  key_recovery_interval_ms?: number;
  max_disable_before_revoke?: number;
  invalid_keys_file?: string;
}

export interface NormalizedSearchResult {
  provider: string;
  attempts: number;
  query?: string;
  results?: unknown[];
  [key: string]: unknown;
}

export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}

export type KeyHealthStatus = "active" | "disabled" | "revoked";

export interface KeyHealthState {
  status: KeyHealthStatus;
  disableCount: number;
  disabledAt: number | null;
}

export interface KeySelection<T = unknown> {
  index: number;
  key: T;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 30000;

export const RETRYABLE_HTTP_STATUS = new Set<number>([
  401, 402, 403, 408, 409, 425, 429, 432, 433, 500, 502, 503, 504,
]);

export const AUTH_ERROR_STATUSES = new Set<number>([401, 402, 403]);

export const DEFAULT_HEALTH_OPTS = {
  recoveryIntervalMs: 300_000,
  maxDisableBeforeRevoke: 3,
} as const;

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

export class HttpProviderError extends Error {
  override name = "HttpProviderError";
  provider: string;
  status: number;
  body: string;

  constructor(provider: string, status: number, body: string) {
    super(HttpProviderError.briefMessage(provider, status));
    this.provider = provider;
    this.status = status;
    this.body = body;
  }

  static briefMessage(provider: string, status: number): string {
    switch (status) {
      case 401:
        return `${provider}: invalid API key. Replace or remove it.`;
      case 402:
        return `${provider}: payment required — billing issue or quota exceeded.`;
      case 403:
        return `${provider}: access denied. Check token permissions.`;
      case 429:
        return `${provider}: rate limited. Try again later.`;
      case 408:
        return `${provider}: request timed out. Try again.`;
      case 500:
      case 502:
      case 503:
      case 504:
        return `${provider}: service temporarily unavailable (${status}). Try again later.`;
      default:
        return `${provider}: request failed (HTTP ${status}).`;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Minimal JSONC parser — strips // line comments then delegates to JSON.parse.
 * Only supports // line comments (not block comments).
 * Handles quoted strings correctly (won't strip // inside strings like URLs).
 */
export function parseJsonc(text: string): unknown {
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

export function normalizeBaseUrl(
  value: string | undefined,
  fallback: string,
): string {
  if (!value || typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function parsePositiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function compactObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }

  return compacted;
}

// --- Coercion helpers ---
// Some LLM / MCP clients serialize boolean/number as strings.
// These preprocess values before Zod schema validation for compatibility.

export function coerceBool(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

export function coerceInt(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return v;
}

export function coerceNum(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/**
 * For boolean | enum union types: try boolean coercion first,
 * otherwise keep the original value (may be an enum string like "basic").
 */
export function coerceBoolOrEnum(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeJsonParse(text: string | null): unknown {
  if (!text || typeof text !== "string") {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function stringifyForToolContent(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function maskKey(
  key: unknown,
): string | Record<string, string> {
  if (typeof key === "string") {
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "..." + key.slice(-4);
  }
  if (key && typeof key === "object") {
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(key)) {
      masked[k] = typeof v === "string" ? (maskKey(v) as string) : "****";
    }
    return masked;
  }
  return "****";
}

// ---------------------------------------------------------------------------
// Zod Helpers
// ---------------------------------------------------------------------------

export function optionalPreprocess(
  preprocessor: (v: unknown) => unknown,
  schema: z.ZodTypeAny,
) {
  return z.preprocess(preprocessor, schema).optional();
}

export function optionalBoolSchema() {
  return optionalPreprocess(coerceBool, z.boolean());
}

export function optionalIntSchema(schema: z.ZodTypeAny) {
  return optionalPreprocess(coerceInt, schema);
}

export function optionalNumSchema(schema: z.ZodTypeAny) {
  return optionalPreprocess(coerceNum, schema);
}

export function optionalBoolOrEnumSchema(schema: z.ZodTypeAny) {
  return optionalPreprocess(coerceBoolOrEnum, schema);
}

export const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .url()
  .refine(isHttpUrl, "Must be a valid absolute http(s) URL.");

export const optionalHttpUrlSchema = httpUrlSchema.optional();
