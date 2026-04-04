export interface CacheConfig {
  maxSize: number;
  defaultTtlMs: number;
  perKey?: Record<string, number>;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

export class ResultCache {
  private entries = new Map<string, CacheEntry>();
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
      this.entries.delete(key);
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
      this.entries.delete(key);
    } else if (this.entries.size >= this.config.maxSize) {
      this.evictOldest();
    }

    this.entries.set(key, { data, expiresAt: Date.now() + resolvedTtl });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
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
      evictions: this._evictions,
    };
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    this.entries.delete(oldest);
    this._evictions++;
  }
}
