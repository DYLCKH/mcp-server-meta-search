export function render() {
  return `
    <div id="logs-page">
      <h1>Logs</h1>
      <div class="tabs" id="log-tabs">
        <button class="tab active" data-tab="requests">Request Logs</button>
        <button class="tab" data-tab="audit">Audit Logs</button>
      </div>
      <div id="log-filters"></div>
      <div id="log-content">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>
  `;
}

export async function init(root, api, state, navigate) {
  const tabs = root.querySelector('#log-tabs');
  const filtersEl = root.querySelector('#log-filters');
  const content = root.querySelector('#log-content');

  let currentTab = 'requests';
  let page = 0;
  const PAGE_SIZE = 50;

  async function loadLogs() {
    content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const filters = getFilters(filtersEl);
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE, ...filters };

    try {
      const data = currentTab === 'requests'
        ? await api.getRequestLogs(params)
        : await api.getAuditLogs(params);

      content.innerHTML = currentTab === 'requests'
        ? renderRequestLogs(data)
        : renderAuditLogs(data);
    } catch (err) {
      content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderFilters() {
    if (currentTab === 'requests') {
      filtersEl.innerHTML = `
        <div class="filters">
          <div class="form-group">
            <label>Tool</label>
            <input type="text" id="filter-tool" placeholder="Filter by tool">
          </div>
          <div class="form-group">
            <label>Provider</label>
            <input type="text" id="filter-provider" placeholder="Filter by provider">
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="filter-status">
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div class="form-group">
            <label>From</label>
            <input type="datetime-local" id="filter-from">
          </div>
          <div class="form-group">
            <label>To</label>
            <input type="datetime-local" id="filter-to">
          </div>
          <button class="btn btn-primary" id="apply-filters" style="align-self:flex-end">Filter</button>
        </div>
      `;
    } else {
      filtersEl.innerHTML = `
        <div class="filters">
          <div class="form-group">
            <label>Action</label>
            <input type="text" id="filter-action" placeholder="Filter by action">
          </div>
          <div class="form-group">
            <label>Target</label>
            <input type="text" id="filter-target" placeholder="Filter by target">
          </div>
          <div class="form-group">
            <label>From</label>
            <input type="datetime-local" id="filter-from">
          </div>
          <div class="form-group">
            <label>To</label>
            <input type="datetime-local" id="filter-to">
          </div>
          <button class="btn btn-primary" id="apply-filters" style="align-self:flex-end">Filter</button>
        </div>
      `;
    }

    filtersEl.querySelector('#apply-filters')?.addEventListener('click', () => {
      page = 0;
      loadLogs();
    });
  }

  // Tab switching
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    page = 0;
    renderFilters();
    loadLogs();
  });

  // Pagination delegated events
  content.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    page = parseInt(btn.dataset.page);
    loadLogs();
  });

  renderFilters();
  await loadLogs();
}

function getFilters(filtersEl) {
  const params = {};
  const tool = filtersEl.querySelector('#filter-tool')?.value?.trim();
  const provider = filtersEl.querySelector('#filter-provider')?.value?.trim();
  const status = filtersEl.querySelector('#filter-status')?.value;
  const action = filtersEl.querySelector('#filter-action')?.value?.trim();
  const target = filtersEl.querySelector('#filter-target')?.value?.trim();
  const from = filtersEl.querySelector('#filter-from')?.value;
  const to = filtersEl.querySelector('#filter-to')?.value;

  if (tool) params.tool = tool;
  if (provider) params.provider = provider;
  if (status) params.status = status;
  if (action) params.action = action;
  if (target) params.target = target;
  if (from) params.from = new Date(from).toISOString();
  if (to) params.to = new Date(to).toISOString();
  return params;
}

function renderRequestLogs(data) {
  const logs = data.logs || data || [];
  const total = data.total || logs.length;
  const hasMore = data.hasMore || false;
  const offset = data.offset || 0;

  if (!logs.length) {
    return '<div class="card"><p class="text-muted">No request logs found.</p></div>';
  }

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Tool</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => `
              <tr>
                <td class="text-muted mono">${formatDate(log.timestamp || log.createdAt)}</td>
                <td>${escapeHtml(log.tool || '-')}</td>
                <td>${escapeHtml(log.provider || '-')}</td>
                <td>
                  <span class="badge ${log.status === 'success' ? 'badge-active' : 'badge-revoked'}">
                    ${escapeHtml(log.status || '-')}
                  </span>
                </td>
                <td class="mono">${formatDuration(log.latency || log.durationMs)}</td>
                <td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(log.error || '')}">${escapeHtml(log.error || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${renderPagination(offset, logs.length, total, hasMore)}
  `;
}

function renderAuditLogs(data) {
  const logs = data.logs || data || [];
  const total = data.total || logs.length;
  const hasMore = data.hasMore || false;
  const offset = data.offset || 0;

  if (!logs.length) {
    return '<div class="card"><p class="text-muted">No audit logs found.</p></div>';
  }

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => `
              <tr>
                <td class="text-muted mono">${formatDate(log.timestamp || log.createdAt)}</td>
                <td><strong>${escapeHtml(log.action || '-')}</strong></td>
                <td class="mono">${escapeHtml(log.target || '-')}</td>
                <td class="text-muted" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(log.details || log.detail || '')}">${escapeHtml(log.details || log.detail || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${renderPagination(offset, logs.length, total, hasMore)}
  `;
}

function renderPagination(offset, count, total, hasMore) {
  const page = Math.floor(offset / 50);
  const from = offset + 1;
  const to = offset + count;
  return `
    <div class="pagination">
      <span>Showing ${from}-${to} of ${total}</span>
      <div class="pagination-buttons">
        <button class="btn btn-sm" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn-sm" data-page="${page + 1}" ${!hasMore ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
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
