import { createHash } from "node:crypto";
import type { PatRecord } from "@meta-search/config";

export interface PatIndexEntry {
  hash: string;
  prefix: string;
  disabled: boolean;
  expiresAt: Date | null;
}

export interface PatSnapshot {
  /** Map from token hash to PAT entry */
  byHash: Map<string, PatIndexEntry>;
  /** Whether any PATs are configured at all */
  hasPats: boolean;
}

export function buildPatSnapshot(pats: PatRecord[] | undefined): PatSnapshot {
  const byHash = new Map<string, PatIndexEntry>();

  if (!pats || pats.length === 0) {
    return { byHash, hasPats: false };
  }

  for (const pat of pats) {
    const expiresAt = pat.expires_at ? new Date(pat.expires_at) : null;
    byHash.set(pat.hash, {
      hash: pat.hash,
      prefix: pat.prefix,
      disabled: pat.disabled ?? false,
      expiresAt,
    });
  }

  return { byHash, hasPats: true };
}

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Validate a Bearer token against the PAT snapshot.
 * Returns true if the token is valid (or if no PATs are configured).
 * Returns false if the token is invalid, disabled, or expired.
 */
export function validateBearerToken(
  token: string,
  snapshot: PatSnapshot,
): boolean {
  if (!snapshot.hasPats) {
    return true;
  }

  const hash = hashBearerToken(token);
  const entry = snapshot.byHash.get(hash);
  if (!entry) {
    return false;
  }

  if (entry.disabled) {
    return false;
  }

  if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
    return false;
  }

  return true;
}
