import { createHash, timingSafeEqual } from "node:crypto";

// Legacy SHA-256 hash of the literal string "password" — shipped as the
// placeholder in older config.jsonc.example files. Detect-and-warn if still in
// use so operators are nudged to rotate.
const DEFAULT_LEGACY_SHA256_HASH =
  "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";

const ARGON2_PREFIX = "$argon2";

/**
 * Hash a plaintext password with argon2id (Bun built-in).
 * Output is the encoded string form that embeds the algorithm, parameters, and
 * salt (e.g. `$argon2id$v=19$m=65536,t=2,p=1$<salt>$<hash>`), so `verifyPassword`
 * can round-trip without additional metadata.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, "argon2id");
}

export function isArgon2Hash(hash: string): boolean {
  return hash.startsWith(ARGON2_PREFIX);
}

export function isLegacySha256Hash(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

export function isDefaultLegacyHash(hash: string): boolean {
  return hash.toLowerCase() === DEFAULT_LEGACY_SHA256_HASH;
}

function legacyVerify(plaintext: string, storedHex: string): boolean {
  const inputHex = createHash("sha256").update(plaintext).digest("hex");
  const a = Buffer.from(inputHex, "utf8");
  const b = Buffer.from(storedHex.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a plaintext password against a stored hash. Accepts both argon2id
 * encoded hashes (current format) and unsalted SHA-256 hex (legacy format, kept
 * so existing deployments continue to authenticate while they migrate).
 */
export async function verifyPassword(
  plaintext: string,
  storedHash: string,
): Promise<boolean> {
  if (isArgon2Hash(storedHash)) {
    try {
      return await Bun.password.verify(plaintext, storedHash);
    } catch {
      return false;
    }
  }
  if (isLegacySha256Hash(storedHash)) {
    return legacyVerify(plaintext, storedHash);
  }
  return false;
}
