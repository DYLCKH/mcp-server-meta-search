export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxRequests: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(provider: string) {
    super(`CircuitBreaker[${provider}]: circuit is open`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private _state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private halfOpenRequests = 0;
  private openedAt = 0;
  private _failures = 0;
  private _successes = 0;
  private _rejections = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;

    switch (state) {
      case 'open':
        this._rejections++;
        throw new CircuitOpenError(this.name);

      case 'half-open':
        if (this.halfOpenRequests >= this.config.halfOpenMaxRequests) {
          this._rejections++;
          throw new CircuitOpenError(this.name);
        }
        this.halfOpenRequests++;
        return this.executeAndTrack(fn);

      case 'closed':
        return this.executeAndTrack(fn);
    }
  }

  get state(): CircuitState {
    return this.currentState;
  }

  get stats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    rejections: number;
  } {
    return {
      state: this.currentState,
      failures: this._failures,
      successes: this._successes,
      rejections: this._rejections,
    };
  }

  reset(): void {
    this._state = 'closed';
    this.consecutiveFailures = 0;
    this.halfOpenRequests = 0;
    this.openedAt = 0;
    this._failures = 0;
    this._successes = 0;
    this._rejections = 0;
  }

  private get currentState(): CircuitState {
    if (this._state === 'open') {
      if (Date.now() - this.openedAt >= this.config.resetTimeoutMs) {
        this._state = 'half-open';
        this.halfOpenRequests = 0;
      }
    }
    return this._state;
  }

  private async executeAndTrack<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this._successes++;
    this.consecutiveFailures = 0;

    if (this._state === 'half-open') {
      this._state = 'closed';
      this.halfOpenRequests = 0;
    }
  }

  private onFailure(): void {
    this._failures++;
    this.consecutiveFailures++;

    if (this._state === 'half-open') {
      this._state = 'open';
      this.openedAt = Date.now();
      this.halfOpenRequests = 0;
    } else if (this.consecutiveFailures >= this.config.failureThreshold) {
      this._state = 'open';
      this.openedAt = Date.now();
    }
  }
}
