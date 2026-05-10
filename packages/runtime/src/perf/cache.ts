import { Buffer } from "node:buffer";

export interface CacheConfig {
  maxSize: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  defaultTtlMs: number;
  perKey?: Record<string, number>;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
  bytes: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  bytes: number;
  evictions: number;
}

export class ResultCache {
  private entries = new Map<string, CacheEntry>();
  private currentBytes = 0;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private readonly config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
  }

  get(key: string): { data: unknown; hit: true } | { hit: false } {
    const entry = this.entries.get(key);
    if (!entry) {
      this._misses++;
      return { hit: false };
    }

    if (Date.now() >= entry.expiresAt) {
      this.delete(key);
      this._misses++;
      return { hit: false };
    }

    // Refresh insertion order so Map keeps most-recently-used keys at the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this._hits++;
    return { data: entry.data, hit: true };
  }

  set(key: string, data: unknown, ttlMs?: number): void {
    if (this.config.maxSize <= 0) {
      return;
    }

    const bytes = estimateValueBytes(data);
    if (
      (this.config.maxEntryBytes !== undefined &&
        bytes > this.config.maxEntryBytes) ||
      (this.config.maxBytes !== undefined && bytes > this.config.maxBytes)
    ) {
      this.delete(key);
      return;
    }

    // Determine TTL: per-key prefix match > default
    let resolvedTtl = this.config.defaultTtlMs;
    if (ttlMs !== undefined) {
      resolvedTtl = ttlMs;
    } else if (this.config.perKey) {
      for (const [prefix, prefixTtl] of Object.entries(this.config.perKey)) {
        if (key.startsWith(prefix)) {
          resolvedTtl = prefixTtl;
          break;
        }
      }
    }

    if (this.entries.has(key)) {
      this.delete(key);
    }

    while (this.entries.size >= this.config.maxSize) {
      this.evictOldest();
    }

    while (
      this.config.maxBytes !== undefined &&
      this.currentBytes + bytes > this.config.maxBytes
    ) {
      if (!this.evictOldest()) return;
    }

    this.entries.set(key, { data, expiresAt: Date.now() + resolvedTtl, bytes });
    this.currentBytes += bytes;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.currentBytes -= entry.bytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }

  reset(): void {
    this.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  get stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.entries.size,
      bytes: this.currentBytes,
      evictions: this._evictions,
    };
  }

  private evictOldest(): boolean {
    const oldest = this.entries.keys().next().value;
    if (oldest === undefined) {
      return false;
    }
    this.delete(oldest);
    this._evictions++;
    return true;
  }
}

function estimateValueBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;

  switch (typeof value) {
    case "string":
      return Buffer.byteLength(value, "utf8");
    case "number":
    case "bigint":
      return 8;
    case "boolean":
      return 4;
    case "symbol":
    case "function":
      return 0;
    case "object":
      break;
  }

  if (seen.has(value)) return 0;
  seen.add(value);

  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;

  let bytes = 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      bytes += estimateValueBytes(item, seen);
    }
    return bytes;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    bytes += Buffer.byteLength(key, "utf8");
    bytes += estimateValueBytes(item, seen);
  }
  return bytes;
}
