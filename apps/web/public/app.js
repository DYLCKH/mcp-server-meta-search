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

  login: (password) =>
    api.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  async getDashboard() {
    const data = await api.request('/dashboard');
    return {
      ...data,
      providers: normalizeProviderSummaries(data),
      patCount: data.patCount ?? data.pat_count ?? 0,
    };
  },

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

  deleteKey: (name, index) =>
    api.request(`/providers/${encodeURIComponent(name)}/keys/${index}`, { method: 'DELETE' }),

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

  revealPat: (name) =>
    api.request(`/pats/${encodeURIComponent(name)}/reveal`, { method: 'POST' }),

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

  deletePat: (name) =>
    api.request(`/pats/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  getSettings: () => api.request('/settings'),
  saveSettings: (data) =>
    api.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

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

const PAGE_META = {
  dashboard: {
    label: 'Dashboard',
    description: 'Fleet health, key capacity, and token posture at a glance.',
  },
  providers: {
    label: 'Providers',
    description: 'Inspect provider pools, rotate keys, and recover degraded capacity.',
  },
  pats: {
    label: 'PATs',
    description: 'Manage personal access tokens used to authenticate downstream clients.',
  },
  settings: {
    label: 'Settings',
    description: 'Tune retry, timeout, and key lifecycle policy without redeploying.',
  },
  logs: {
    label: 'Logs',
    description: 'Trace request outcomes and audit sensitive admin actions.',
  },
};

const state = { authenticated: false, notify: showToast };
const pageModules = {};

async function loadPage(name) {
  if (!pageModules[name]) {
    const mod = await import(`/app/pages/${name}.js`);
    pageModules[name] = mod;
  }
  return pageModules[name];
}

function navigate(hash) {
  location.hash = hash;
}

async function handleRoute() {
  const hash = location.hash || '#/dashboard';
  const [, path] = hash.match(/^#(\/[^?]*)/) || ['', '/dashboard'];
  const content = document.getElementById('app');

  if (path === '/login') {
    const page = await loadPage('login');
    content.innerHTML = page.render(state);
    page.init(content, api, state, navigate);
    return;
  }

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
  content.innerHTML = renderShell(pageName);

  const pageContent = document.getElementById('page-content');
  pageContent.innerHTML = page.render(state);
  initShell(content);

  try {
    await page.init(pageContent, api, state, navigate);
  } catch (err) {
    pageContent.innerHTML = `<div class="alert alert-error">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderShell(activePage) {
  const navItems = [
    { href: '#/dashboard', label: 'Dashboard', description: 'Health and capacity', id: 'dashboard' },
    { href: '#/providers', label: 'Providers', description: 'Key pools and status', id: 'providers' },
    { href: '#/pats', label: 'PATs', description: 'Token lifecycle', id: 'pats' },
    { href: '#/settings', label: 'Settings', description: 'Runtime policy', id: 'settings' },
    { href: '#/logs', label: 'Logs', description: 'Requests and audit', id: 'logs' },
  ];
  const activeMeta = PAGE_META[activePage] || PAGE_META.dashboard;

  return `
    <div class="app-layout">
      <div class="app-backdrop" id="nav-backdrop"></div>
      <aside class="sidebar" id="app-sidebar">
        <div class="sidebar-brand">
          <span class="sidebar-eyebrow">Meta Search</span>
          <strong>Control Center</strong>
          <p>Operate providers, tokens, and runtime policy from one secure surface.</p>
        </div>
        <ul class="sidebar-nav">
          ${navItems.map((item) => `
            <li>
              <a href="${item.href}" class="sidebar-link ${item.id === activePage ? 'active' : ''}">
                <span class="sidebar-link-copy">
                  <span class="sidebar-link-label">${item.label}</span>
                  <span class="sidebar-link-desc">${item.description}</span>
                </span>
                <span class="sidebar-link-dot" aria-hidden="true"></span>
              </a>
            </li>
          `).join('')}
        </ul>
        <div class="sidebar-footer">
          <div class="sidebar-footnote">
            <span class="sidebar-footnote-label">Current view</span>
            <strong>${activeMeta.label}</strong>
          </div>
          <button id="logout-btn" class="btn btn-ghost sidebar-logout" type="button">Sign out</button>
        </div>
      </aside>
      <div class="app-main">
        <header class="topbar">
          <div class="topbar-inner">
            <button id="nav-toggle" class="nav-toggle" type="button" aria-label="Open navigation">
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div class="topbar-copy">
              <span class="topbar-label">Secure Admin Surface</span>
              <strong class="topbar-heading">Meta Search Control Center</strong>
              <p class="topbar-subtitle">${activeMeta.description}</p>
            </div>
            <div class="topbar-meta">
              <span class="topbar-chip">${activeMeta.label}</span>
              <span class="topbar-chip subtle">Live configuration</span>
            </div>
          </div>
        </header>
        <main class="main-content">
          <div class="content-shell" id="page-content"></div>
        </main>
      </div>
    </div>
  `;
}

function initShell(content) {
  const navToggle = document.getElementById('nav-toggle');
  const navBackdrop = document.getElementById('nav-backdrop');
  const logoutBtn = document.getElementById('logout-btn');
  const navLinks = content.querySelectorAll('.sidebar-link');
  const closeNav = () => document.body.classList.remove('nav-open');

  closeNav();

  navToggle?.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });

  navBackdrop?.addEventListener('click', closeNav);
  navLinks.forEach((link) => link.addEventListener('click', closeNav));

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
      } catch {}

      state.authenticated = false;
      closeNav();
      navigate('#/login');
    });
  }
}

function ensureToastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.className = 'toast-stack';
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'true');
    document.body.appendChild(root);
  }
  return root;
}

function showToast(message, type = 'info') {
  const root = ensureToastRoot();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div class="toast-body">${escapeHtml(message)}</div>`;
  root.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  const removeToast = () => {
    toast.classList.remove('visible');
    window.setTimeout(() => {
      toast.remove();
    }, 180);
  };

  window.setTimeout(removeToast, 3200);
  toast.addEventListener('click', removeToast, { once: true });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
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

window.addEventListener('hashchange', handleRoute);
handleRoute();

export { api, state, navigate, escapeHtml, formatDate, formatDuration };
