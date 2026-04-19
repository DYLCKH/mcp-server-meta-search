import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  isArgon2Hash,
  isLegacySha256Hash,
  isDefaultLegacyHash,
} from "./password.js";

// Vitest spawns Node workers where the `Bun` global is absent. The production
// server always runs under Bun, so gate argon2id roundtrip tests on runtime
// availability. Legacy SHA-256 tests use only node:crypto and always run.
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const itBun = hasBun ? it : it.skip;

describe("password hashing", () => {
  itBun("produces argon2id encoded hashes", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(isArgon2Hash(hash)).toBe(true);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  itBun("round-trips via verifyPassword", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  itBun("produces distinct hashes for the same plaintext (random salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("verifies legacy unsalted SHA-256 hashes", async () => {
    const legacyHash = createHash("sha256").update("old-admin").digest("hex");
    expect(isLegacySha256Hash(legacyHash)).toBe(true);
    expect(isArgon2Hash(legacyHash)).toBe(false);
    expect(await verifyPassword("old-admin", legacyHash)).toBe(true);
    expect(await verifyPassword("old-admin-typo", legacyHash)).toBe(false);
  });

  it("detects the shipped default example hash", () => {
    const defaultHash = createHash("sha256").update("password").digest("hex");
    expect(isDefaultLegacyHash(defaultHash)).toBe(true);
    expect(isDefaultLegacyHash(defaultHash.toUpperCase())).toBe(true);
  });

  it("rejects unknown hash formats", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

