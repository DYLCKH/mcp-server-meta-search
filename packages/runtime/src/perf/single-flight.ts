export class SingleFlight {
  private inflight = new Map<string, Promise<unknown>>();
  private _deduplicated = 0;
  private _unique = 0;

  async dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      this._deduplicated++;
      return existing as Promise<T>;
    }

    this._unique++;
    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  get stats(): { deduplicated: number; unique: number; inflight: number } {
    return {
      deduplicated: this._deduplicated,
      unique: this._unique,
      inflight: this.inflight.size,
    };
  }

  reset(): void {
    this.inflight.clear();
    this._deduplicated = 0;
    this._unique = 0;
  }
}
