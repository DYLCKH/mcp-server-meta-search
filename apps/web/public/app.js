// API Client
const API_BASE = '/api/admin';

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
  getDashboard: () => api.request('/dashboard'),

  // Providers
  getProviders: () => api.request('/providers'),
  getProvider: (name) => api.request(`/providers/${encodeURIComponent(name)}`),
  addKey: (name, key) => api.request(`/providers/${encodeURIComponent(name)}/keys`, { method: 'POST', body: JSON.stringify({ key }) }),
  updateKey: (name, index, data) => api.request(`/providers/${encodeURIComponent(name)}/keys/${index}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKey: (name, index) => api.request(`/providers/${encodeURIComponent(name)}/keys/${index}`, { method: 'DELETE' }),

  // PATs
  getPats: () => api.request('/pats'),
  createPat: (data) => api.request('/pats', { method: 'POST', body: JSON.stringify(data) }),
  getPat: (name) => api.request(`/pats/${encodeURIComponent(name)}`),
  revealPat: (name) => api.request(`/pats/${encodeURIComponent(name)}/reveal`, { method: 'POST' }),
  updatePat: (name, data) => api.request(`/pats/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePat: (name) => api.request(`/pats/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Settings
  getSettings: () => api.request('/settings'),
  saveSettings: (data) => api.request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Logs
  getRequestLogs: (params = {}) => api.request(`/logs/requests?${new URLSearchParams(params)}`),
  getAuditLogs: (params = {}) => api.request(`/logs/audit?${new URLSearchParams(params)}`),
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
