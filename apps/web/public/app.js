// API Client
const API_BASE = '/api/admin';

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

function normalizeProviderSummary(provider) {
  const active = provider.activeKeys ?? provider.active ?? 0;
  const disabled = provider.disabledKeys ?? provider.disabled ?? 0;
  const revoked = provider.revokedKeys ?? provider.revoked ?? 0;

  return {
    ...provider,
    name: provider.name,
    total: provider.total ?? active + disabled + revoked,
    active,
    disabled,
    revoked,
    activeKeys: active,
    disabledKeys: disabled,
    revokedKeys: revoked,
  };
}

function normalizeProviderSummaries(payload) {
  if (Array.isArray(payload?.providers)) {
    return payload.providers.map(normalizeProviderSummary);
  }

  return Object.entries(payload?.providers || {}).map(([name, provider]) =>
    normalizeProviderSummary({ name, ...provider }),
  );
}

function normalizeProviderKey(key) {
  const status =
    key.status ??
    key.health?.status ??
    (key.enabled === false ? 'disabled' : 'active');

  return {
    ...key,
    status,
    enabled: status === 'active',
    masked: key.masked ?? key.hint ?? key.key ?? '***',
    lastUsed: key.lastUsed ?? key.last_used_at ?? null,
  };
}

function normalizePat(pat) {
  const disabled = pat.disabled ?? pat.enabled === false;

  return {
    ...pat,
    disabled,
    enabled: !disabled,
    createdAt: pat.createdAt ?? pat.created_at ?? null,
    lastUsedAt: pat.lastUsedAt ?? pat.last_used_at ?? null,
    expiresAt: pat.expiresAt ?? pat.expires_at ?? null,
  };
}

function normalizeRequestLog(log) {
  return {
    ...log,
    createdAt: log.createdAt ?? log.created_at ?? log.timestamp ?? null,
    latency: log.latency ?? log.latency_ms ?? log.durationMs ?? log.duration_ms ?? null,
  };
}

function normalizeAuditLog(log) {
  return {
    ...log,
    createdAt: log.createdAt ?? log.created_at ?? log.timestamp ?? null,
    target: log.target ?? log.target_id ?? log.target_name ?? log.target_type ?? '-',
    detail: log.detail ?? log.details ?? null,
  };
}

const api = {
  async request(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      credentials: 'same-origin',
      ...options,
    });
    if (res.status === 401) {
      location.hash = '#/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // Auth
  login: (password) => api.request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),

  // Dashboard
  async getDashboard() {
    const data = await api.request('/dashboard');
    return {
      ...data,
      providers: normalizeProviderSummaries(data),
      patCount: data.patCount ?? data.pat_count ?? 0,
    };
  },

  // Providers
  async getProviders() {
    const data = await api.request('/providers');
    return { ...data, providers: normalizeProviderSummaries(data) };
  },
  async getProvider(name) {
    const data = await api.request(`/providers/${encodeURIComponent(name)}`);
    return {
      ...data,
      keys: ensureArray(data.keys).map(normalizeProviderKey),
    };
  },
  addKey: (name, key) =>
    api.request(`/providers/${encodeURIComponent(name)}/keys`, {
      method: 'POST',
      body: JSON.stringify({ api_key: key }),
    }),
  updateKey: (name, index, data) => {
    const payload = Object.prototype.hasOwnProperty.call(data, 'enabled')
      ? { disabled: !data.enabled }
      : data;

    return api.request(`/providers/${encodeURIComponent(name)}/keys/${index}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteKey: (name, index) => api.request(`/providers/${encodeURIComponent(name)}/keys/${index}`, { method: 'DELETE' }),

  // PATs
  async getPats() {
    const data = await api.request('/pats');
    return { ...data, pats: ensureArray(data.pats).map(normalizePat) };
  },
  createPat: (data) =>
    api.request('/pats', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        note: data.note,
        expires_at: data.expiresAt ?? data.expires_at,
      }),
    }),
  async getPat(name) {
    const data = await api.request(`/pats/${encodeURIComponent(name)}`);
    return normalizePat(data);
  },
  revealPat: (name) => api.request(`/pats/${encodeURIComponent(name)}/reveal`, { method: 'POST' }),
  updatePat: (name, data) => {
    const payload = { ...data };
    if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
      payload.disabled = !payload.enabled;
      delete payload.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'expiresAt')) {
      payload.expires_at = payload.expiresAt;
      delete payload.expiresAt;
    }
    return api.request(`/pats/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deletePat: (name) => api.request(`/pats/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Settings
  getSettings: () => api.request('/settings'),
  saveSettings: (data) => api.request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Logs
  async getRequestLogs(params = {}) {
    const data = await api.request(`/logs/requests${buildQueryString(params)}`);
    return {
      ...data,
      logs: ensureArray(data.logs).map(normalizeRequestLog),
    };
  },
  async getAuditLogs(params = {}) {
    const query = { ...params };
    if (Object.prototype.hasOwnProperty.call(query, 'target')) {
      query.target_type = query.target;
      delete query.target;
    }

    const data = await api.request(`/logs/audit${buildQueryString(query)}`);
    return {
      ...data,
      logs: ensureArray(data.logs).map(normalizeAuditLog),
    };
  },
};

// Simple state
const state = { authenticated: false };

// Page modules loaded dynamically
const pageModules = {};

async function loadPage(name) {
  if (!pageModules[name]) {
    const mod = await import(`/app/pages/${name}.js`);
    pageModules[name] = mod;
  }
  return pageModules[name];
}

// Router
function navigate(hash) {
  location.hash = hash;
}

async function handleRoute() {
  const hash = location.hash || '#/dashboard';
  const [, path] = hash.match(/^#(\/[^?]*)/) || ['', '/dashboard'];
  const content = document.getElementById('app');

  // Public routes
  if (path === '/login') {
    const page = await loadPage('login');
    content.innerHTML = page.render(state);
    page.init(content, api, state, navigate);
    return;
  }

  // Protected routes - check auth
  if (!state.authenticated) {
    try {
      await api.getDashboard();
      state.authenticated = true;
    } catch {
      navigate('#/login');
      return;
    }
  }

  const routes = {
    '/dashboard': 'dashboard',
    '/providers': 'providers',
    '/pats': 'pats',
    '/settings': 'settings',
    '/logs': 'logs',
  };

  const pageName = routes[path];
  if (!pageName) {
    navigate('#/dashboard');
    return;
  }

  const page = await loadPage(pageName);

  // Render shell with sidebar for protected pages
  content.innerHTML = renderShell(pageName);
  document.getElementById('page-content').innerHTML = page.render(state);
  initShell(content);

  try {
    await page.init(document.getElementById('page-content'), api, state, navigate);
  } catch (err) {
    document.getElementById('page-content').innerHTML = `<div class="alert alert-error">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderShell(activePage) {
  const navItems = [
    { href: '#/dashboard', label: 'Dashboard', id: 'dashboard' },
    { href: '#/providers', label: 'Providers', id: 'providers' },
    { href: '#/pats', label: 'PATs', id: 'pats' },
    { href: '#/settings', label: 'Settings', id: 'settings' },
    { href: '#/logs', label: 'Logs', id: 'logs' },
  ];

  return `
    <div class="app-layout">
      <aside class="sidebar">
        <div class="sidebar-brand">Meta Search</div>
        <ul class="sidebar-nav">
          ${navItems.map(item => `
            <li><a href="${item.href}" class="${item.id === activePage ? 'active' : ''}">${item.label}</a></li>
          `).join('')}
        </ul>
        <div class="sidebar-footer">
          <button id="logout-btn">Sign out</button>
        </div>
      </aside>
      <main class="main-content" id="page-content"></main>
    </div>
  `;
}

function initShell(content) {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' }); } catch {}
      state.authenticated = false;
      navigate('#/login');
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function formatDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Boot
window.addEventListener('hashchange', handleRoute);
handleRoute();

export { api, state, navigate, escapeHtml, formatDate, formatDuration };
