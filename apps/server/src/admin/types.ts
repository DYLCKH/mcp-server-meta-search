import type { ResolvedConfig } from "@meta-search/config";
import type { KeyPool } from "@meta-search/runtime";
import type { PatSnapshot } from "../middleware/pat-auth.js";
import type { RuntimeState } from "../mcp/transport.js";

// ---------------------------------------------------------------------------
// DB Handle (provided by db module)
// ---------------------------------------------------------------------------

export interface DbHandle {
  queryRequestLogs(filters: RequestLogFilters): RequestLogEntry[];
  queryAuditLogs(filters: AuditLogFilters): AuditLogEntry[];
  insertAuditLog(entry: AuditLogWriteEntry): void;
}

export interface RequestLogFilters {
  tool?: string;
  provider?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface RequestLogEntry {
  id?: number;
  timestamp?: string;
  tool: string;
  provider?: string | null;
  pat_name?: string | null;
  status: "success" | "error";
  latency_ms?: number | null;
  error?: string | null;
  attempts?: number;
}

export interface AuditLogFilters {
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogEntry {
  id?: number;
  timestamp?: string;
  action: string;
  actor?: string;
  target_type?: string | null;
  target_id?: string | null;
  details?: string | null;
}

export interface AuditLogWriteEntry {
  action: string;
  target_type: string;
  target_name: string;
  detail: string | null;
}

// ---------------------------------------------------------------------------
// Admin Dependencies
// ---------------------------------------------------------------------------

export interface AdminDeps {
  configPath: string;
  /** Mutable reference to the current runtime state */
  runtimeState: RuntimeStateRef;
  /** Mutable reference to the PAT snapshot */
  patSnapshot: PatSnapshotRef;
  /** DB handle for logs */
  db: DbHandle;
}

export interface RuntimeStateRef {
  current: RuntimeState;
}

export interface PatSnapshotRef {
  current: PatSnapshot;
}

// ---------------------------------------------------------------------------
// Provider registry — maps provider name to config key & key pool getter
// ---------------------------------------------------------------------------

export type ProviderName = "tavily" | "exa" | "perplexity" | "jina" | "cloudflare";

export const PROVIDER_NAMES: ProviderName[] = [
  "tavily",
  "exa",
  "perplexity",
  "jina",
  "cloudflare",
];

export function getKeyPool(
  rt: RuntimeStateRef["current"],
  name: ProviderName,
): KeyPool {
  switch (name) {
    case "tavily":
      return rt.tavilyKeyPool;
    case "exa":
      return rt.exaKeyPool;
    case "perplexity":
      return rt.perplexityKeyPool;
    case "jina":
      return rt.jinaKeyPool;
    case "cloudflare":
      return rt.cloudflareKeyPool;
  }
}
