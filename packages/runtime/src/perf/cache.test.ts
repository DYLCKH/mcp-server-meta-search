import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultCache } from "./cache.js";

describe("ResultCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts the least recently used entry", () => {
    const cache = new ResultCache({
      maxSize: 2,
      defaultTtlMs: 1_000,
    });

    cache.set("a", "alpha");
    cache.set("b", "beta");

    expect(cache.get("a")).toEqual({ data: "alpha", hit: true });

    cache.set("c", "gamma");

    expect(cache.get("b")).toEqual({ hit: false });
    expect(cache.get("a")).toEqual({ data: "alpha", hit: true });
    expect(cache.get("c")).toEqual({ data: "gamma", hit: true });
    expect(cache.stats.evictions).toBe(1);
  });

  it("drops expired entries on access", () => {
    const cache = new ResultCache({
      maxSize: 1,
      defaultTtlMs: 500,
    });

    cache.set("stale", "value");
    vi.advanceTimersByTime(500);

    expect(cache.get("stale")).toEqual({ hit: false });
    expect(cache.stats.size).toBe(0);
    expect(cache.stats.misses).toBe(1);
  });

  it("skips storing entries when maxSize is zero", () => {
    const cache = new ResultCache({
      maxSize: 0,
      defaultTtlMs: 1_000,
    });

    cache.set("never", "stored");

    expect(cache.get("never")).toEqual({ hit: false });
    expect(cache.stats.size).toBe(0);
  });
});
