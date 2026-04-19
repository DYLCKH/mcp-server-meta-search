const API_BASE = "/api/admin";

export const UNAUTHORIZED_EVENT = "meta-search:unauthorized";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export interface ProviderSummary {
  name: string;
  total: number;
  activeKeys: number;
  disabledKeys: number;
  revokedKeys: number;
}

export interface ProviderKey {
  index?: number;
  status: string;
  enabled: boolean;
  masked: string;
  lastUsed: string | null;
}

export interface ProviderDetail {
  provider: string;
  total: number;
  active: number;
  keys: ProviderKey[];
}

export interface DashboardData {
  providers: ProviderSummary[];
  patCount: number;
}

export interface PatRecord {
  name: string;
  prefix: string | null;
  note: string | null;
  disabled: boolean;
  enabled: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface SettingsData {
  key_rotation_strategy: "round_robin" | "random";
  max_attempts_per_request: number;
  request_timeout_ms: number;
  key_recovery_interval_ms: number;
  max_disable_before_revoke: number;
}

export interface RequestLog {
  createdAt: string | null;
  latency: number | null;
  tool: string | null;
  provider: string | null;
  status: string | null;
  error: string | null;
}

export interface AuditLog {
  createdAt: string | null;
  action: string | null;
  target: string | null;
  detail: string | null;
}

export interface PaginatedResponse<T> {
  logs: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function buildQueryString(params: Record<string, unknown>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function normalizeProviderSummary(
  provider: Partial<ProviderSummary> & { name: string },
): ProviderSummary {
  const active = provider.activeKeys ?? 0;
  const disabled = provider.disabledKeys ?? 0;
  const revoked = provider.revokedKeys ?? 0;

  return {
    name: provider.name,
    total: provider.total ?? active + disabled + revoked,
    activeKeys: active,
    disabledKeys: disabled,
    revokedKeys: revoked,
  };
}

function normalizeProviderSummaries(payload: {
  providers?:
    | Record<
        string,
        Partial<ProviderSummary> & {
          active?: number;
          disabled?: number;
          revoked?: number;
        }
      >
    | ProviderSummary[];
}) {
  if (Array.isArray(payload.providers)) {
    return payload.providers.map((provider) =>
      normalizeProviderSummary(provider),
    );
  }

  return Object.entries(payload.providers || {}).map(([name, provider]) =>
    normalizeProviderSummary({
      name,
      total: provider.total,
      activeKeys: provider.activeKeys ?? provider.active ?? 0,
      disabledKeys: provider.disabledKeys ?? provider.disabled ?? 0,
      revokedKeys: provider.revokedKeys ?? provider.revoked ?? 0,
    }),
  );
}

function normalizeProviderKey(key: Record<string, unknown>): ProviderKey {
  const status =
    (key.status as string | undefined) ??
    (key.health as { status?: string } | undefined)?.status ??
    ((key.enabled as boolean | undefined) === false ? "disabled" : "active");

  return {
    index: typeof key.index === "number" ? key.index : undefined,
    status,
    enabled: status === "active",
    masked:
      (key.masked as string | undefined) ??
      (key.hint as string | undefined) ??
      "***",
    lastUsed:
      (key.lastUsed as string | null | undefined) ??
      ((key.health as { lastUsedAt?: string | null } | undefined)?.lastUsedAt ??
        null),
  };
}

function normalizePat(pat: Record<string, unknown>): PatRecord {
  const disabled =
    (pat.disabled as boolean | undefined) ??
    (pat.enabled as boolean | undefined) === false;

  return {
    name: String(pat.name ?? ""),
    prefix: (pat.prefix as string | null | undefined) ?? null,
    note: (pat.note as string | null | undefined) ?? null,
    disabled,
    enabled: !disabled,
    createdAt:
      (pat.createdAt as string | null | undefined) ??
      (pat.created_at as string | null | undefined) ??
      null,
    lastUsedAt:
      (pat.lastUsedAt as string | null | undefined) ??
      (pat.last_used_at as string | null | undefined) ??
      null,
    expiresAt:
      (pat.expiresAt as string | null | undefined) ??
      (pat.expires_at as string | null | undefined) ??
      null,
  };
}

function normalizeRequestLog(log: Record<string, unknown>): RequestLog {
  return {
    createdAt:
      (log.createdAt as string | null | undefined) ??
      (log.created_at as string | null | undefined) ??
      (log.timestamp as string | null | undefined) ??
      null,
    latency:
      (log.latency as number | null | undefined) ??
      (log.latency_ms as number | null | undefined) ??
      (log.durationMs as number | null | undefined) ??
      (log.duration_ms as number | null | undefined) ??
      null,
    tool: (log.tool as string | null | undefined) ?? null,
    provider: (log.provider as string | null | undefined) ?? null,
    status: (log.status as string | null | undefined) ?? null,
    error: (log.error as string | null | undefined) ?? null,
  };
}

function normalizeAuditLog(log: Record<string, unknown>): AuditLog {
  return {
    createdAt:
      (log.createdAt as string | null | undefined) ??
      (log.created_at as string | null | undefined) ??
      (log.timestamp as string | null | undefined) ??
      null,
    action: (log.action as string | null | undefined) ?? null,
    target:
      (log.target as string | null | undefined) ??
      (log.target_id as string | null | undefined) ??
      (log.target_name as string | null | undefined) ??
      (log.target_type as string | null | undefined) ??
      "-",
    detail:
      (log.detail as string | null | undefined) ??
      (log.details as string | null | undefined) ??
      null,
  };
}

async function request<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  login(password: string) {
    return request<{ ok: true }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  async logout() {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
  },

  async getDashboard() {
    const data = await request<{
      providers?: Record<string, Partial<ProviderSummary>>;
      pat_count?: number;
      patCount?: number;
    }>("/dashboard");

    return {
      providers: normalizeProviderSummaries(data),
      patCount: data.patCount ?? data.pat_count ?? 0,
    } satisfies DashboardData;
  },

  async getProviders() {
    const data = await request<{
      providers?: Record<string, Partial<ProviderSummary>> | ProviderSummary[];
    }>("/providers");

    return {
      providers: normalizeProviderSummaries(data),
    };
  },

  async getProvider(name: string) {
    const data = await request<{
      provider: string;
      total: number;
      active: number;
      keys?: Record<string, unknown>[];
    }>(`/providers/${encodeURIComponent(name)}`);

    return {
      provider: data.provider,
      total: data.total,
      active: data.active,
      keys: ensureArray<Record<string, unknown>>(data.keys).map(
        normalizeProviderKey,
      ),
    } satisfies ProviderDetail;
  },

  addKey(name: string, key: string | { account_id: string; api_token: string }) {
    return request<{ ok: true }>(`/providers/${encodeURIComponent(name)}/keys`, {
      method: "POST",
      body: JSON.stringify({ api_key: key }),
    });
  },

  updateKey(name: string, index: number, data: { enabled?: boolean }) {
    const payload =
      data.enabled === undefined ? data : { disabled: !data.enabled };

    return request<{ ok: true }>(
      `/providers/${encodeURIComponent(name)}/keys/${index}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  },

  deleteKey(name: string, index: number) {
    return request<{ ok: true }>(
      `/providers/${encodeURIComponent(name)}/keys/${index}`,
      {
        method: "DELETE",
      },
    );
  },

  async getPats() {
    const data = await request<{ pats?: Record<string, unknown>[] }>("/pats");
    return {
      pats: ensureArray<Record<string, unknown>>(data.pats).map(normalizePat),
    };
  },

  createPat(data: {
    name: string;
    note?: string;
    expiresAt?: string;
  }) {
    return request<{ ok: true; token: string; prefix: string }>("/pats", {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        note: data.note,
        expires_at: data.expiresAt,
      }),
    });
  },

  revealPat(name: string) {
    return request<{ message?: string }>(`/pats/${encodeURIComponent(name)}/reveal`, {
      method: "POST",
    });
  },

  updatePat(
    name: string,
    data: {
      enabled?: boolean;
      note?: string;
      expiresAt?: string | null;
    },
  ) {
    const payload: Record<string, unknown> = { ...data };

    if (Object.prototype.hasOwnProperty.call(payload, "enabled")) {
      payload.disabled = !payload.enabled;
      delete payload.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "expiresAt")) {
      payload.expires_at = payload.expiresAt;
      delete payload.expiresAt;
    }

    return request<{ ok: true }>(`/pats/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deletePat(name: string) {
    return request<{ ok: true }>(`/pats/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  getSettings() {
    return request<SettingsData>("/settings");
  },

  saveSettings(settings: SettingsData) {
    return request<{ ok: true; settings: SettingsData }>("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  },

  async getRequestLogs(params: Record<string, unknown>) {
    const data = await request<PaginatedResponse<Record<string, unknown>>>(
      `/logs/requests${buildQueryString(params)}`,
    );

    return {
      ...data,
      logs: ensureArray<Record<string, unknown>>(data.logs).map(
        normalizeRequestLog,
      ),
    } satisfies PaginatedResponse<RequestLog>;
  },

  async getAuditLogs(params: Record<string, unknown>) {
    const data = await request<PaginatedResponse<Record<string, unknown>>>(
      `/logs/audit${buildQueryString(params)}`,
    );

    return {
      ...data,
      logs: ensureArray<Record<string, unknown>>(data.logs).map(
        normalizeAuditLog,
      ),
    } satisfies PaginatedResponse<AuditLog>;
  },
};
