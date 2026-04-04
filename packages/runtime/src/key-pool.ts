import { createHash, randomBytes } from "node:crypto";

export interface KeySelection {
  index: number;
  key: unknown;
}

export interface KeyHealthState {
  status: "active" | "disabled" | "revoked";
  disableCount: number;
  disabledAt: number | null;
}

export interface KeyPoolHealthOpts {
  recoveryIntervalMs?: number;
  maxDisableBeforeRevoke?: number;
}

export interface KeyPoolOpts {
  providerName: string;
  keys: unknown[];
  strategy?: "round_robin" | "random";
  health?: KeyPoolHealthOpts;
  onKeyRevoked?: (
    providerName: string,
    index: number,
    key: unknown,
    error: Error,
  ) => void;
}

export class KeyPool {
  readonly providerName: string;
  readonly keys: unknown[];
  readonly strategy: "round_robin" | "random";
  readonly recoveryIntervalMs: number;
  readonly maxDisableBeforeRevoke: number;
  readonly onKeyRevoked?: KeyPoolOpts["onKeyRevoked"];

  private nextIndex = 0;
  private readonly keyState: KeyHealthState[];

  constructor(opts: KeyPoolOpts) {
    this.providerName = opts.providerName;
    this.keys = opts.keys;
    this.strategy = opts.strategy === "random" ? "random" : "round_robin";
    this.recoveryIntervalMs = opts.health?.recoveryIntervalMs ?? 300_000;
    this.maxDisableBeforeRevoke = opts.health?.maxDisableBeforeRevoke ?? 3;
    this.onKeyRevoked = opts.onKeyRevoked;

    this.keyState = opts.keys.map(() => ({
      status: "active" as const,
      disableCount: 0,
      disabledAt: null,
    }));
  }

  hasKeys(): boolean {
    return this.keys.length > 0;
  }

  hasActiveKeys(): boolean {
    return this.keyState.some((s) => s.status === "active");
  }

  size(): number {
    return this.keys.length;
  }

  activeSize(): number {
    return this.keyState.filter((s) => s.status === "active").length;
  }

  acquire(triedIndices: Set<number>): KeySelection | null {
    if (!this.hasKeys()) return null;

    const now = Date.now();
    const available: number[] = [];

    for (let index = 0; index < this.keys.length; index++) {
      if (triedIndices.has(index)) continue;

      const state = this.keyState[index];
      if (state.status === "revoked") continue;

      if (state.status === "disabled") {
        if (
          this.recoveryIntervalMs > 0 &&
          state.disabledAt &&
          now - state.disabledAt >= this.recoveryIntervalMs
        ) {
          state.status = "active";
        } else {
          continue;
        }
      }

      available.push(index);
    }

    if (available.length === 0) return null;

    let selectedIndex: number;
    if (this.strategy === "random") {
      selectedIndex = available[Math.floor(Math.random() * available.length)];
    } else {
      selectedIndex =
        available.find((i) => i >= this.nextIndex) ?? available[0];
    }

    return { index: selectedIndex, key: this.keys[selectedIndex] };
  }

  markSuccess(index: number): void {
    if (!this.hasKeys()) return;
    this.nextIndex = (index + 1) % this.keys.length;
  }

  disable(index: number): "disabled" | "revoked" {
    const state = this.keyState[index];
    if (!state || state.status === "revoked") return "revoked";

    state.disableCount += 1;
    state.disabledAt = Date.now();

    if (state.disableCount >= this.maxDisableBeforeRevoke) {
      state.status = "revoked";
      return "revoked";
    }

    state.status = "disabled";
    return "disabled";
  }

  getStatus(index: number): KeyHealthState {
    return this.keyState[index];
  }

  getStates(): readonly KeyHealthState[] {
    return this.keyState;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generatePat(): { token: string; prefix: string; hash: string } {
  const token = `pat_${randomBytes(32).toString("hex")}`;
  const prefix = token.slice(0, 8);
  const hash = hashToken(token);
  return { token, prefix, hash };
}
