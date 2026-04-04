export interface ConcurrencyConfig {
  maxConcurrency: number;
  maxQueueSize: number;
  queueTimeoutMs: number;
}

interface QueuedRequest {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ConcurrencyLimiter {
  private active = 0;
  private queue: QueuedRequest[] = [];
  private _rejected = 0;

  constructor(
    private readonly name: string,
    private readonly config: ConcurrencyConfig,
  ) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.config.maxConcurrency) {
      this.active++;
      return this.createRelease();
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      this._rejected++;
      throw new Error(
        `ConcurrencyLimiter[${this.name}]: queue full (${this.config.maxQueueSize})`,
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          this._rejected++;
          reject(
            new Error(
              `ConcurrencyLimiter[${this.name}]: queue timeout (${this.config.queueTimeoutMs}ms)`,
            ),
          );
        }
      }, this.config.queueTimeoutMs);

      const entry: QueuedRequest = { resolve, reject, timer };
      this.queue.push(entry);
    });
  }

  get stats(): { active: number; queued: number; rejected: number } {
    return {
      active: this.active,
      queued: this.queue.length,
      rejected: this._rejected,
    };
  }

  reset(): void {
    // Reject all queued requests
    for (const entry of this.queue) {
      clearTimeout(entry.timer);
      entry.reject(
        new Error(`ConcurrencyLimiter[${this.name}]: reset while queued`),
      );
    }
    this.queue = [];
    this.active = 0;
    this._rejected = 0;
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      // Service next queued request
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        clearTimeout(next.timer);
        next.resolve(this.createRelease());
      } else {
        this.active--;
      }
    };
  }
}
