export interface ProviderStats {
  requestCount: number;
  errorCount: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  lastRequestAt: number | null;
}

interface LatencyBucket {
  latencies: number[];
  maxSize: number;
  /** Write cursor; once >= maxSize we overwrite in place (ring buffer). */
  cursor: number;
}

interface ProviderMetrics {
  requests: Map<string, number>; // tool+status -> count
  latency: LatencyBucket;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  lastRequestAt: number | null;
}

const MAX_LATENCY_SAMPLES = 1000;

export class MetricsCollector {
  private providers = new Map<string, ProviderMetrics>();
  private _cacheHits = 0;
  private _cacheMisses = 0;

  recordRequest(
    provider: string,
    tool: string,
    latencyMs: number,
    status: 'success' | 'error',
  ): void {
    const metrics = this.getOrCreateProvider(provider);

    // Update counters
    const key = `${tool}:${status}`;
    metrics.requests.set(key, (metrics.requests.get(key) ?? 0) + 1);

    // Update latency stats
    metrics.totalLatencyMs += latencyMs;
    if (metrics.minLatencyMs === 0 || latencyMs < metrics.minLatencyMs) {
      metrics.minLatencyMs = latencyMs;
    }
    if (latencyMs > metrics.maxLatencyMs) {
      metrics.maxLatencyMs = latencyMs;
    }

    // Store latency sample (ring buffer, O(1) overwrite once full)
    const bucket = metrics.latency;
    if (bucket.latencies.length < bucket.maxSize) {
      bucket.latencies.push(latencyMs);
    } else {
      bucket.latencies[bucket.cursor] = latencyMs;
    }
    bucket.cursor = (bucket.cursor + 1) % bucket.maxSize;

    metrics.lastRequestAt = Date.now();
  }

  recordCacheHit(hit: boolean): void {
    if (hit) {
      this._cacheHits++;
    } else {
      this._cacheMisses++;
    }
  }

  getProviderStats(provider: string): ProviderStats {
    const metrics = this.providers.get(provider);
    if (!metrics) {
      return this.emptyStats();
    }
    return this.computeStats(metrics);
  }

  getAllProviderStats(): Map<string, ProviderStats> {
    const result = new Map<string, ProviderStats>();
    for (const [provider] of this.providers) {
      result.set(provider, this.getProviderStats(provider));
    }
    return result;
  }

  resetIntervalStats(): void {
    this.providers.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  getPrometheusMetrics(): string {
    const lines: string[] = [];

    // Request counters
    for (const [provider, metrics] of this.providers) {
      for (const [key, count] of metrics.requests) {
        const [tool, status] = key.split(':');
        lines.push(
          `meta_search_requests_total{provider="${provider}",tool="${tool}",status="${status}"} ${count}`,
        );
      }
    }

    // Latency quantiles
    for (const [provider, metrics] of this.providers) {
      if (metrics.latency.latencies.length === 0) continue;
      const sorted = [...metrics.latency.latencies].sort((a, b) => a - b);
      const p50 = this.percentile(sorted, 0.5);
      const p95 = this.percentile(sorted, 0.95);
      const p99 = this.percentile(sorted, 0.99);
      lines.push(
        `meta_search_request_latency_ms{provider="${provider}",quantile="0.5"} ${p50}`,
      );
      lines.push(
        `meta_search_request_latency_ms{provider="${provider}",quantile="0.95"} ${p95}`,
      );
      lines.push(
        `meta_search_request_latency_ms{provider="${provider}",quantile="0.99"} ${p99}`,
      );
    }

    // Cache stats
    lines.push(`meta_search_cache_hits_total ${this._cacheHits}`);
    lines.push(`meta_search_cache_misses_total ${this._cacheMisses}`);

    return lines.join('\n') + '\n';
  }

  getJsonMetrics(): Record<string, unknown> {
    const providerStats: Record<string, ProviderStats> = {};
    for (const [provider] of this.providers) {
      providerStats[provider] = this.getProviderStats(provider);
    }
    return {
      cache: { hits: this._cacheHits, misses: this._cacheMisses },
      providers: providerStats,
    };
  }

  private getOrCreateProvider(provider: string): ProviderMetrics {
    let metrics = this.providers.get(provider);
    if (!metrics) {
      metrics = {
        requests: new Map(),
        latency: { latencies: [], maxSize: MAX_LATENCY_SAMPLES, cursor: 0 },
        totalLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        lastRequestAt: null,
      };
      this.providers.set(provider, metrics);
    }
    return metrics;
  }

  private computeStats(metrics: ProviderMetrics): ProviderStats {
    const latencies = metrics.latency.latencies;
    const requestCount = this.sumMap(metrics.requests);
    const errorCount = this.countErrors(metrics.requests);

    if (latencies.length === 0) {
      return {
        requestCount,
        errorCount,
        totalLatencyMs: metrics.totalLatencyMs,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        lastRequestAt: metrics.lastRequestAt,
      };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    return {
      requestCount,
      errorCount,
      totalLatencyMs: metrics.totalLatencyMs,
      minLatencyMs: sorted[0],
      maxLatencyMs: sorted[sorted.length - 1],
      avgLatencyMs: requestCount > 0 ? metrics.totalLatencyMs / requestCount : 0,
      p50LatencyMs: this.percentile(sorted, 0.5),
      p95LatencyMs: this.percentile(sorted, 0.95),
      p99LatencyMs: this.percentile(sorted, 0.99),
      lastRequestAt: metrics.lastRequestAt,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private sumMap(map: Map<string, number>): number {
    let total = 0;
    for (const count of map.values()) total += count;
    return total;
  }

  private countErrors(map: Map<string, number>): number {
    let total = 0;
    for (const [key, count] of map) {
      if (key.endsWith(':error')) total += count;
    }
    return total;
  }

  private emptyStats(): ProviderStats {
    return {
      requestCount: 0,
      errorCount: 0,
      totalLatencyMs: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      lastRequestAt: null,
    };
  }
}
