import { createHash } from "node:crypto";
import type { PatRecord } from "@meta-search/config";

export interface PatIndexEntry {
  name: string;
  hash: string;
  prefix: string;
  disabled: boolean;
  expiresAt: Date | null;
  /** Last time this PAT was used successfully (unix ms). Mutable. */
  lastUsedAt: number | null;
}

export interface PatSnapshot {
  /** Map from token hash to PAT entry */
  byHash: Map<string, PatIndexEntry>;
  /** Map from PAT name to PAT entry */
  byName: Map<string, PatIndexEntry>;
  /** Whether any PATs are configured at all */
  hasPats: boolean;
}

export function buildPatSnapshot(pats: PatRecord[] | undefined): PatSnapshot {
  const byHash = new Map<string, PatIndexEntry>();
  const byName = new Map<string, PatIndexEntry>();

  if (!pats || pats.length === 0) {
    return { byHash, byName, hasPats: false };
  }

  for (const pat of pats) {
    const expiresAt = pat.expires_at ? new Date(pat.expires_at) : null;
    const lastUsedAt = pat.last_used_at
      ? new Date(pat.last_used_at).getTime()
      : null;
    const entry: PatIndexEntry = {
      name: pat.name,
      hash: pat.hash,
      prefix: pat.prefix,
      disabled: pat.disabled ?? false,
      expiresAt,
      lastUsedAt: Number.isFinite(lastUsedAt) ? lastUsedAt : null,
    };
    byHash.set(pat.hash, entry);
    byName.set(pat.name, entry);
  }

  return { byHash, byName, hasPats: true };
}

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ValidateTokenResult {
  valid: boolean;
  /** PAT name when the token matched a configured PAT; null otherwise. */
  patName: string | null;
}

/**
 * Validate a Bearer token against the PAT snapshot. On successful match the
 * entry's `lastUsedAt` is refreshed in memory so admin endpoints can surface
 * the timestamp (persistence is not guaranteed across restarts).
 */
export function validateBearerToken(
  token: string,
  snapshot: PatSnapshot,
): ValidateTokenResult {
  if (!snapshot.hasPats) {
    return { valid: true, patName: null };
  }

  const hash = hashBearerToken(token);
  const entry = snapshot.byHash.get(hash);
  if (!entry) {
    return { valid: false, patName: null };
  }

  if (entry.disabled) {
    return { valid: false, patName: null };
  }

  if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
    return { valid: false, patName: null };
  }

  entry.lastUsedAt = Date.now();
  return { valid: true, patName: entry.name };
}
