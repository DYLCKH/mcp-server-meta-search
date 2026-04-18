import { Database } from "bun:sqlite";

// ── Types ──────────────────────────────────────────────────────────────────

export interface McpRequestLogEntry {
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

export interface AuditLogEntry {
  id?: number;
  timestamp?: string;
  action: string;
  actor?: string;
  target_type?: string | null;
  target_id?: string | null;
  details?: string | null;
}

export interface RequestLogFilters {
  tool?: string;
  provider?: string;
  status?: "success" | "error";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogFilters {
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface RequestStats {
  total: number;
  success: number;
  error: number;
  avg_latency_ms: number | null;
  per_tool: Record<string, { count: number; success: number; error: number }>;
}

// ── Write Queue ────────────────────────────────────────────────────────────

type QueuedWrite =
  | { table: "mcp_request_logs"; entry: McpRequestLogEntry }
  | { table: "admin_audit_logs"; entry: AuditLogEntry };

const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD = 50;

// ── Module State ───────────────────────────────────────────────────────────

let db: Database | null = null;
let writeQueue: QueuedWrite[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

// ── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mcp_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,
  provider TEXT,
  pat_name TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  error TEXT,
  attempts INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'admin',
  target_type TEXT,
  target_id TEXT,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON mcp_request_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_tool ON mcp_request_logs(tool);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON admin_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON admin_audit_logs(action);
`;

// ── Prepared Statements (lazy) ─────────────────────────────────────────────

let stmtInsertRequest: ReturnType<Database["prepare"]> | null = null;
let stmtInsertAudit: ReturnType<Database["prepare"]> | null = null;

function getInsertRequestStmt() {
  if (!stmtInsertRequest) {
    stmtInsertRequest = db!.prepare(`
      INSERT INTO mcp_request_logs (tool, provider, pat_name, status, latency_ms, error, attempts)
      VALUES ($tool, $provider, $pat_name, $status, $latency_ms, $error, $attempts)
    `);
  }
  return stmtInsertRequest;
}

function getInsertAuditStmt() {
  if (!stmtInsertAudit) {
    stmtInsertAudit = db!.prepare(`
      INSERT INTO admin_audit_logs (action, actor, target_type, target_id, details)
      VALUES ($action, $actor, $target_type, $target_id, $details)
    `);
  }
  return stmtInsertAudit;
}

// ── Flush Logic ────────────────────────────────────────────────────────────

function flushQueue(): void {
  if (!db || writeQueue.length === 0) return;

  const batch = writeQueue.splice(0, writeQueue.length);
  const insertMany = db.transaction(() => {
    for (const item of batch) {
      if (item.table === "mcp_request_logs") {
        const e = item.entry;
        getInsertRequestStmt().run({
          $tool: e.tool,
          $provider: e.provider ?? null,
          $pat_name: e.pat_name ?? null,
          $status: e.status,
          $latency_ms: e.latency_ms ?? null,
          $error: e.error ?? null,
          $attempts: e.attempts ?? 1,
        });
      } else {
        const e = item.entry;
        getInsertAuditStmt().run({
          $action: e.action,
          $actor: e.actor ?? "admin",
          $target_type: e.target_type ?? null,
          $target_id: e.target_id ?? null,
          $details: e.details ?? null,
        });
      }
    }
  });
  insertMany();
}

// ── Public API ─────────────────────────────────────────────────────────────

export function initDatabase(dbPath: string): Database {
  if (db) throw new Error("Database already initialized");

  db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  flushTimer = setInterval(flushQueue, FLUSH_INTERVAL_MS);

  return db;
}

export function closeDatabase(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushQueue();
  stmtInsertRequest = null;
  stmtInsertAudit = null;
  if (db) {
    db.close();
    db = null;
  }
}

// ── Write (async / queued) ─────────────────────────────────────────────────

export function logMcpRequest(entry: McpRequestLogEntry): void {
  writeQueue.push({ table: "mcp_request_logs", entry });
  if (writeQueue.length >= FLUSH_THRESHOLD) {
    flushQueue();
  }
}

export function logAuditEvent(entry: AuditLogEntry): void {
  writeQueue.push({ table: "admin_audit_logs", entry });
  if (writeQueue.length >= FLUSH_THRESHOLD) {
    flushQueue();
  }
}

// ── Query ──────────────────────────────────────────────────────────────────

export function queryRequestLogs(filters: RequestLogFilters = {}): McpRequestLogEntry[] {
  if (!db) throw new Error("Database not initialized");

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.tool) {
    clauses.push("tool = $tool");
    params.$tool = filters.tool;
  }
  if (filters.provider) {
    clauses.push("provider = $provider");
    params.$provider = filters.provider;
  }
  if (filters.status) {
    clauses.push("status = $status");
    params.$status = filters.status;
  }
  if (filters.from) {
    clauses.push("timestamp >= $from");
    params.$from = filters.from;
  }
  if (filters.to) {
    clauses.push("timestamp <= $to");
    params.$to = filters.to;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const stmt = db.prepare(
    `SELECT * FROM mcp_request_logs ${where} ORDER BY timestamp DESC LIMIT $limit OFFSET $offset`,
  );
  return stmt.all({ ...params, $limit: limit, $offset: offset }) as McpRequestLogEntry[];
}

export function queryAuditLogs(filters: AuditLogFilters = {}): AuditLogEntry[] {
  if (!db) throw new Error("Database not initialized");

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.action) {
    clauses.push("action = $action");
    params.$action = filters.action;
  }
  if (filters.target_type) {
    clauses.push("target_type = $target_type");
    params.$target_type = filters.target_type;
  }
  if (filters.from) {
    clauses.push("timestamp >= $from");
    params.$from = filters.from;
  }
  if (filters.to) {
    clauses.push("timestamp <= $to");
    params.$to = filters.to;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const stmt = db.prepare(
    `SELECT * FROM admin_audit_logs ${where} ORDER BY timestamp DESC LIMIT $limit OFFSET $offset`,
  );
  return stmt.all({ ...params, $limit: limit, $offset: offset }) as AuditLogEntry[];
}

export function getRequestStats(from?: string, to?: string): RequestStats {
  if (!db) throw new Error("Database not initialized");

  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (from) {
    clauses.push("timestamp >= $from");
    params.$from = from;
  }
  if (to) {
    clauses.push("timestamp <= $to");
    params.$to = to;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const summaryRow = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
         AVG(latency_ms) as avg_latency_ms
       FROM mcp_request_logs ${where}`,
    )
    .get(params) as Record<string, unknown>;

  const toolRows = db
    .prepare(
      `SELECT
         tool,
         COUNT(*) as count,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error
       FROM mcp_request_logs ${where}
       GROUP BY tool`,
    )
    .all(params) as Array<{ tool: string; count: number; success: number; error: number }>;

  const per_tool: RequestStats["per_tool"] = {};
  for (const row of toolRows) {
    per_tool[row.tool] = { count: row.count, success: row.success, error: row.error };
  }

  return {
    total: (summaryRow.total as number) ?? 0,
    success: (summaryRow.success as number) ?? 0,
    error: (summaryRow.error as number) ?? 0,
    avg_latency_ms: summaryRow.avg_latency_ms != null ? Number(summaryRow.avg_latency_ms) : null,
    per_tool,
  };
}
