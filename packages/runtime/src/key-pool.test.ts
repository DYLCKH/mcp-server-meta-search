import { describe, expect, it } from "vitest";
import { KeyPool } from "./key-pool.js";

describe("KeyPool.enable", () => {
  it("reactivates a disabled key", () => {
    const pool = new KeyPool({
      providerName: "test",
      keys: ["a"],
      health: {
        recoveryIntervalMs: 1000,
        maxDisableBeforeRevoke: 3,
      },
    });

    expect(pool.disable(0)).toBe("disabled");
    expect(pool.getStatus(0).status).toBe("disabled");

    expect(pool.enable(0)).toBe(true);
    expect(pool.getStatus(0).status).toBe("active");
    expect(pool.getStatus(0).disabledAt).toBeNull();
  });

  it("does not restore revoked keys", () => {
    const pool = new KeyPool({
      providerName: "test",
      keys: ["a"],
      health: {
        recoveryIntervalMs: 1000,
        maxDisableBeforeRevoke: 1,
      },
    });

    expect(pool.disable(0)).toBe("revoked");
    expect(pool.enable(0)).toBe(false);
    expect(pool.getStatus(0).status).toBe("revoked");
  });
});
