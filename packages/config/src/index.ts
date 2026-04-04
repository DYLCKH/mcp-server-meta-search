import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { z } from "zod";

// ---------------------------------------------------------------------------
// JSONC Parser
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

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const ProviderKeysSchema = z.object({
  api_keys: z.array(z.string()).optional(),
  base_url: z.string().optional(),
});

const CloudflareAccountSchema = z.object({
  account_id: z.string(),
  api_token: z.string(),
});

const CloudflareConfigSchema = z.object({
  accounts: z.array(CloudflareAccountSchema).optional(),
  base_url: z.string().optional(),
});

const PatRecordSchema = z.object({
  name: z.string(),
  prefix: z.string(),
  hash: z.string(),
  encrypted: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
  disabled: z.boolean().optional(),
  note: z.string().nullable().optional(),
  created_at: z.string().optional(),
  last_used_at: z.string().nullable().optional(),
});

const AdminAuthSchema = z.object({
  password_hash: z.string().optional(),
  session_secret: z.string().optional(),
  session_ttl_ms: z.number().optional(),
});

const PerformanceSchema = z.object({
  cache: z.object({
    enabled: z.boolean().optional(),
    maxSize: z.number().optional(),
    defaultTtlMs: z.number().optional(),
  }).optional(),
  concurrency: z.object({
    maxConcurrency: z.number().optional(),
    maxQueueSize: z.number().optional(),
    queueTimeoutMs: z.number().optional(),
  }).optional(),
  circuitBreaker: z.object({
    enabled: z.boolean().optional(),
    failureThreshold: z.number().optional(),
    resetTimeoutMs: z.number().optional(),
  }).optional(),
  singleFlight: z.object({
    enabled: z.boolean().optional(),
  }).optional(),
}).optional();

const AppConfigSchema = z.object({
  tavily: ProviderKeysSchema.optional(),
  exa: ProviderKeysSchema.optional(),
  perplexity: ProviderKeysSchema.optional(),
  jina: ProviderKeysSchema.optional(),
  cloudflare: CloudflareConfigSchema.optional(),
  key_rotation_strategy: z.enum(["round_robin", "random"]).optional(),
  max_attempts_per_request: z.number().optional(),
  request_timeout_ms: z.number().optional(),
  key_recovery_interval_ms: z.number().optional(),
  max_disable_before_revoke: z.number().optional(),
  invalid_keys_file: z.string().optional(),
  pats: z.array(PatRecordSchema).optional(),
  admin: AdminAuthSchema.optional(),
  performance: PerformanceSchema,
});

// ---------------------------------------------------------------------------
// Inferred Types
// ---------------------------------------------------------------------------

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ProviderKeys = z.infer<typeof ProviderKeysSchema>;
export type CloudflareAccount = z.infer<typeof CloudflareAccountSchema>;
export type CloudflareConfig = z.infer<typeof CloudflareConfigSchema>;
export type PatRecord = z.infer<typeof PatRecordSchema>;
export type AdminAuth = z.infer<typeof AdminAuthSchema>;
export type PerformanceConfig = z.infer<typeof PerformanceSchema>;

export interface ResolvedPerformanceConfig {
  cache: {
    enabled: boolean;
    maxSize: number;
    defaultTtlMs: number;
  };
  concurrency: {
    maxConcurrency: number;
    maxQueueSize: number;
    queueTimeoutMs: number;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeoutMs: number;
  };
  singleFlight: {
    enabled: boolean;
  };
}

export interface ResolvedConfig {
  tavily?: ProviderKeys;
  exa?: ProviderKeys;
  perplexity?: ProviderKeys;
  jina?: ProviderKeys;
  cloudflare?: CloudflareConfig;
  pats?: PatRecord[];
  admin?: AdminAuth;
  key_rotation_strategy: "round_robin" | "random";
  max_attempts_per_request: number;
  request_timeout_ms: number;
  key_recovery_interval_ms: number;
  max_disable_before_revoke: number;
  invalid_keys_file: string;
  performance: ResolvedPerformanceConfig;
}

// ---------------------------------------------------------------------------
// Schema Export
// ---------------------------------------------------------------------------

export { AppConfigSchema, ProviderKeysSchema, CloudflareAccountSchema, CloudflareConfigSchema, PatRecordSchema, AdminAuthSchema };

// ---------------------------------------------------------------------------
// Config Loading
// ---------------------------------------------------------------------------

const DEFAULTS = {
  key_rotation_strategy: "round_robin" as const,
  max_attempts_per_request: 0,
  request_timeout_ms: 30000,
  key_recovery_interval_ms: 300_000,
  max_disable_before_revoke: 3,
  invalid_keys_file: "invalid-keys.json",
  performance: {
    cache: { enabled: true, maxSize: 512, defaultTtlMs: 60_000 },
    concurrency: { maxConcurrency: 8, maxQueueSize: 64, queueTimeoutMs: 30_000 },
    circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeoutMs: 30_000 },
    singleFlight: { enabled: true },
  } satisfies ResolvedPerformanceConfig,
};

/**
 * Load and validate a JSONC config file.
 * Returns validated config (partial — only what's in the file) or an empty
 * object if the file is missing.
 */
export function loadConfig(configPath: string): AppConfig {
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseJsonc(raw);
  return AppConfigSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Env Overrides
// ---------------------------------------------------------------------------

/**
 * Apply environment variable overrides to a config object.
 * Mapping: double-underscore separates nesting levels, all lowercased.
 *   TAVILY__API_KEYS → config.tavily.api_keys
 *   CLOUDFLARE__BASE_URL → config.cloudflare.base_url
 * Values are JSON.parse'd if possible, otherwise kept as strings.
 */
export function applyEnvOverrides<T extends Record<string, unknown>>(config: T): T {
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.includes("__") || envVal === undefined) continue;

    const segments = envKey.toLowerCase().split("__");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = config;
    for (let i = 0; i < segments.length - 1; i++) {
      if (target[segments[i]] === undefined || typeof target[segments[i]] !== "object") {
        target[segments[i]] = {};
      }
      target = target[segments[i]];
    }

    const leafKey = segments.at(-1)!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(envVal);
    } catch {
      parsed = envVal;
    }
    target[leafKey] = parsed;
  }
  return config;
}

// ---------------------------------------------------------------------------
// Atomic Config Write
// ---------------------------------------------------------------------------

/**
 * Write config to a file atomically:
 * 1. Write to a temp file in the same directory
 * 2. Create a timestamped backup of the existing file (if present)
 * 3. Rename temp file over the target
 */
export function writeConfigAtomic(configPath: string, config: unknown): void {
  const json = JSON.stringify(config, null, 2);
  const dir = dirname(configPath);

  // Create backup if existing file is present
  if (existsSync(configPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(dir, `config.${timestamp}.bak`);
    writeFileSync(backupPath, readFileSync(configPath, "utf-8"), "utf-8");
  }

  // Write to temp file then atomic rename
  const tmpPath = join(dir, `.config.tmp-${randomUUID()}`);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// Resolved Config
// ---------------------------------------------------------------------------

/**
 * Load config from file, apply env overrides, validate, and fill defaults.
 * This is the main entry point for consumers that need a fully-resolved config.
 */
export function resolveConfig(configPath: string): ResolvedConfig {
  let config = loadConfig(configPath);
  config = applyEnvOverrides(config);
  // Re-validate after env overrides
  config = AppConfigSchema.parse(config);

  const result: ResolvedConfig = {
    tavily: config.tavily,
    exa: config.exa,
    perplexity: config.perplexity,
    jina: config.jina,
    cloudflare: config.cloudflare,
    pats: config.pats,
    admin: config.admin,
    key_rotation_strategy: config.key_rotation_strategy ?? DEFAULTS.key_rotation_strategy,
    max_attempts_per_request: config.max_attempts_per_request ?? DEFAULTS.max_attempts_per_request,
    request_timeout_ms: config.request_timeout_ms ?? DEFAULTS.request_timeout_ms,
    key_recovery_interval_ms: config.key_recovery_interval_ms ?? DEFAULTS.key_recovery_interval_ms,
    max_disable_before_revoke: config.max_disable_before_revoke ?? DEFAULTS.max_disable_before_revoke,
    invalid_keys_file: config.invalid_keys_file ?? DEFAULTS.invalid_keys_file,
    performance: resolvePerformance(config.performance),
  };
  return result;
}

function resolvePerformance(perf?: PerformanceConfig): ResolvedPerformanceConfig {
  const d = DEFAULTS.performance;
  return {
    cache: {
      enabled: perf?.cache?.enabled ?? d.cache.enabled,
      maxSize: perf?.cache?.maxSize ?? d.cache.maxSize,
      defaultTtlMs: perf?.cache?.defaultTtlMs ?? d.cache.defaultTtlMs,
    },
    concurrency: {
      maxConcurrency: perf?.concurrency?.maxConcurrency ?? d.concurrency.maxConcurrency,
      maxQueueSize: perf?.concurrency?.maxQueueSize ?? d.concurrency.maxQueueSize,
      queueTimeoutMs: perf?.concurrency?.queueTimeoutMs ?? d.concurrency.queueTimeoutMs,
    },
    circuitBreaker: {
      enabled: perf?.circuitBreaker?.enabled ?? d.circuitBreaker.enabled,
      failureThreshold: perf?.circuitBreaker?.failureThreshold ?? d.circuitBreaker.failureThreshold,
      resetTimeoutMs: perf?.circuitBreaker?.resetTimeoutMs ?? d.circuitBreaker.resetTimeoutMs,
    },
    singleFlight: {
      enabled: perf?.singleFlight?.enabled ?? d.singleFlight.enabled,
    },
  };
}
