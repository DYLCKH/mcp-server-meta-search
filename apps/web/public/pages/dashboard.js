export function render() {
  return `
    <div id="dashboard-page" class="page-shell">
      <section class="page-hero">
        <div>
          <p class="page-kicker">Operations Overview</p>
          <h1 class="page-title">Search infrastructure at a glance</h1>
          <p class="page-description">
            Keep provider availability, key health, and access-token exposure visible without switching context.
          </p>
        </div>
        <div class="page-actions">
          <a class="btn btn-primary" href="#/providers">Manage Providers</a>
          <a class="btn" href="#/logs">Inspect Logs</a>
        </div>
      </section>
      <div id="dashboard-content" class="section-stack">
        <div class="loading"><div class="spinner"></div> Loading dashboard</div>
      </div>
    </div>
  `;
}

export async function init(root, api) {
  const container = root.querySelector('#dashboard-content');

  try {
    const data = await api.getDashboard();
    container.innerHTML = renderDashboard(data);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Failed to load dashboard: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDashboard(data) {
  const providers = data.providers || [];
  const patCount = data.patCount ?? 0;
  const totalProviders = providers.length;
  const configuredProviders = providers.filter((provider) => (provider.total || 0) > 0).length;
  const healthyProviders = providers.filter((provider) => (provider.activeKeys || 0) > 0).length;
  const totalKeys = providers.reduce((sum, provider) => sum + (provider.total || 0), 0);
  const totalActive = providers.reduce((sum, provider) => sum + (provider.activeKeys || 0), 0);
  const totalDisabled = providers.reduce((sum, provider) => sum + (provider.disabledKeys || 0), 0);
  const totalRevoked = providers.reduce((sum, provider) => sum + (provider.revokedKeys || 0), 0);
  const providerCards = providers
    .slice()
    .sort((left, right) => (right.total || 0) - (left.total || 0))
    .map((provider) => renderProviderCard(provider))
    .join('');

  return `
    <section class="metrics-grid">
      <article class="metric-card metric-card-featured">
        <p class="metric-kicker">Provider Fleet</p>
        <div class="metric-value">${configuredProviders}/${totalProviders}</div>
        <p class="metric-label">providers configured</p>
        <p class="metric-meta">${healthyProviders} healthy, ${Math.max(totalProviders - healthyProviders, 0)} need attention</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Active Capacity</p>
        <div class="metric-value">${totalActive}</div>
        <p class="metric-label">keys serving traffic</p>
        <p class="metric-meta">${totalKeys} total keys across all providers</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Key Posture</p>
        <div class="metric-value">${totalDisabled + totalRevoked}</div>
        <p class="metric-label">keys need operator action</p>
        <p class="metric-meta">${totalDisabled} disabled, ${totalRevoked} revoked</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Access Surface</p>
        <div class="metric-value">${patCount}</div>
        <p class="metric-label">personal access tokens</p>
        <p class="metric-meta">Review PAT usage and rotation regularly</p>
      </article>
    </section>

    <section class="card">
      <div class="section-header">
        <div>
          <p class="section-kicker">Providers</p>
          <h2 class="section-title">Capacity by provider</h2>
          <p class="section-subtitle">Select a provider to inspect its key pool, availability, and last activity.</p>
        </div>
        <a class="btn" href="#/providers">Open Provider Console</a>
      </div>
      ${providerCards
        ? `<div class="provider-overview-grid">${providerCards}</div>`
        : `<div class="empty-state">
            <h3>No providers available</h3>
            <p>Add provider keys to start routing requests through the admin console.</p>
          </div>`}
    </section>
  `;
}

function renderProviderCard(provider) {
  const active = provider.activeKeys || 0;
  const disabled = provider.disabledKeys || 0;
  const revoked = provider.revokedKeys || 0;
  const total = provider.total || 0;
  const healthy = active > 0;
  const mixLabel = total > 0 ? `${Math.round((active / total) * 100)}% active` : 'No keys configured';

  return `
    <a class="provider-overview-card" href="#/providers">
      <div class="provider-overview-head">
        <div>
          <h3>${escapeHtml(provider.name)}</h3>
          <p>${mixLabel}</p>
        </div>
        <span class="badge ${healthy ? 'badge-active' : 'badge-disabled'}">
          ${healthy ? 'Healthy' : 'Needs Attention'}
        </span>
      </div>
      <div class="provider-overview-stats">
        <div class="provider-overview-stat">
          <span class="status-dot active"></span>
          <span>${active} active</span>
        </div>
        <div class="provider-overview-stat">
          <span class="status-dot disabled"></span>
          <span>${disabled} disabled</span>
        </div>
        <div class="provider-overview-stat">
          <span class="status-dot revoked"></span>
          <span>${revoked} revoked</span>
        </div>
      </div>
      <div class="provider-overview-foot">
        <span>${total} total keys</span>
        <span>Open details</span>
      </div>
    </a>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
