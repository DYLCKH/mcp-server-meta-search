export function render() {
  return `
    <div id="dashboard-page">
      <h1>Dashboard</h1>
      <div id="dashboard-content">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>
  `;
}

export async function init(root, api, state, navigate) {
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
  const providerCards = providers.map(p => {
    const active = p.activeKeys || 0;
    const disabled = p.disabledKeys || 0;
    const revoked = p.revokedKeys || 0;
    const healthy = p.healthy !== false && active > 0;

    return `
      <div class="card" style="cursor:pointer" onclick="location.hash='#/providers'">
        <div class="card-header">
          <h3 style="margin:0">${escapeHtml(p.name)}</h3>
          <span class="badge ${healthy ? 'badge-active' : 'badge-disabled'}">
            ${healthy ? 'Healthy' : 'Degraded'}
          </span>
        </div>
        <div style="display:flex;gap:20px;font-size:13px;">
          <div>
            <span class="status-dot active"></span>
            <span>${active} active</span>
          </div>
          <div>
            <span class="status-dot disabled"></span>
            <span>${disabled} disabled</span>
          </div>
          <div>
            <span class="status-dot revoked"></span>
            <span>${revoked} revoked</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const patCount = data.patCount ?? 0;

  return `
    <div class="card-grid">
      ${providerCards}
    </div>
    <div class="card-grid">
      <div class="card">
        <div class="stat-card">
          <div>
            <div class="stat-value">${patCount}</div>
            <div class="stat-label">Personal Access Tokens</div>
          </div>
        </div>
      </div>
      ${data.recentStats ? renderRecentStats(data.recentStats) : ''}
    </div>
  `;
}

function renderRecentStats(stats) {
  if (!stats) return '';
  return `
    <div class="card">
      <div class="stat-card">
        <div>
          <div class="stat-value">${stats.totalRequests ?? '-'}</div>
          <div class="stat-label">Recent Requests</div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
