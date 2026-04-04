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
  private accessOrder: string[] = [];
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
      this.removeFromAccessOrder(key);
      this._misses++;
      return { hit: false };
    }

    // Move to end (most recently used)
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
    this._hits++;
    return { data: entry.data, hit: true };
  }

  set(key: string, data: unknown, ttlMs?: number): void {
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

    // If key already exists, remove from access order (will be re-added at end)
    if (this.entries.has(key)) {
      this.removeFromAccessOrder(key);
    } else if (this.entries.size >= this.config.maxSize) {
      // Evict oldest (LRU)
      const oldest = this.accessOrder.shift();
      if (oldest !== undefined) {
        this.entries.delete(oldest);
        this._evictions++;
      }
    }

    this.entries.set(key, { data, expiresAt: Date.now() + resolvedTtl });
    this.accessOrder.push(key);
  }

  delete(key: string): void {
    if (this.entries.delete(key)) {
      this.removeFromAccessOrder(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.accessOrder = [];
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

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }
}
