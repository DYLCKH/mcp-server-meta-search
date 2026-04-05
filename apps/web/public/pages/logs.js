const PAGE_SIZE = 50;

export function render() {
  return `
    <div id="logs-page" class="page-shell">
      <section class="page-hero">
        <div>
          <p class="page-kicker">Observability</p>
          <h1 class="page-title">Request and audit trails</h1>
          <p class="page-description">
            Filter recent request outcomes and operator actions from one place so investigations do not require database access.
          </p>
        </div>
      </section>
      <section class="card">
        <div class="section-header section-header-tight">
          <div>
            <p class="section-kicker">Filters</p>
            <h2 class="section-title">Slice the event stream</h2>
            <p class="section-subtitle">Switch between request and audit logs, then narrow by time or target.</p>
          </div>
          <div class="tabs" id="log-tabs">
            <button class="tab active" data-tab="requests" type="button">Request Logs</button>
            <button class="tab" data-tab="audit" type="button">Audit Logs</button>
          </div>
        </div>
        <div id="log-filters"></div>
      </section>
      <div id="log-content" class="section-stack">
        <div class="loading"><div class="spinner"></div> Loading logs</div>
      </div>
    </div>
  `;
}

export async function init(root, api) {
  const tabs = root.querySelector('#log-tabs');
  const filtersEl = root.querySelector('#log-filters');
  const content = root.querySelector('#log-content');

  let currentTab = 'requests';
  let page = 0;

  async function loadLogs() {
    content.innerHTML = '<div class="loading"><div class="spinner"></div> Loading logs</div>';

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

  function bindFilterForm() {
    const form = filtersEl.querySelector('#log-filter-form');
    const resetBtn = filtersEl.querySelector('#reset-filters');

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      page = 0;
      loadLogs();
    });

    resetBtn?.addEventListener('click', () => {
      form.reset();
      page = 0;
      loadLogs();
    });
  }

  function renderFilters() {
    if (currentTab === 'requests') {
      filtersEl.innerHTML = `
        <form class="filters" id="log-filter-form">
          <div class="form-group">
            <label for="filter-tool">Tool</label>
            <input type="text" id="filter-tool" placeholder="e.g. web.search">
          </div>
          <div class="form-group">
            <label for="filter-provider">Provider</label>
            <input type="text" id="filter-provider" placeholder="e.g. exa">
          </div>
          <div class="form-group">
            <label for="filter-status">Status</label>
            <select id="filter-status">
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div class="form-group">
            <label for="filter-from">From</label>
            <input type="datetime-local" id="filter-from">
          </div>
          <div class="form-group">
            <label for="filter-to">To</label>
            <input type="datetime-local" id="filter-to">
          </div>
          <div class="filter-actions">
            <button class="btn btn-primary" type="submit">Apply filters</button>
            <button class="btn" type="button" id="reset-filters">Reset</button>
          </div>
        </form>
      `;
    } else {
      filtersEl.innerHTML = `
        <form class="filters" id="log-filter-form">
          <div class="form-group">
            <label for="filter-action">Action</label>
            <input type="text" id="filter-action" placeholder="e.g. create_pat">
          </div>
          <div class="form-group">
            <label for="filter-target">Target</label>
            <input type="text" id="filter-target" placeholder="e.g. provider">
          </div>
          <div class="form-group">
            <label for="filter-from">From</label>
            <input type="datetime-local" id="filter-from">
          </div>
          <div class="form-group">
            <label for="filter-to">To</label>
            <input type="datetime-local" id="filter-to">
          </div>
          <div class="filter-actions">
            <button class="btn btn-primary" type="submit">Apply filters</button>
            <button class="btn" type="button" id="reset-filters">Reset</button>
          </div>
        </form>
      `;
    }

    bindFilterForm();
  }

  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;

    tabs.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    page = 0;
    renderFilters();
    loadLogs();
  });

  content.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;

    page = Number.parseInt(btn.dataset.page, 10);
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
  const hasMore = data.hasMore || false;
  const offset = data.offset || 0;

  if (!logs.length) {
    return '<div class="empty-state"><h3>No request logs found</h3><p>Try widening the time range or removing a filter.</p></div>';
  }

  return `
    <section class="card table-card">
      <div class="section-header section-header-tight">
        <div>
          <p class="section-kicker">Requests</p>
          <h2 class="section-title">Latest provider traffic</h2>
          <p class="section-subtitle">Showing ${logs.length} entries from the current page.</p>
        </div>
        <span class="badge ${hasMore ? 'badge-active' : 'badge-disabled'}">${hasMore ? 'More available' : 'Newest page'}</span>
      </div>
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
            ${logs.map((log) => `
              <tr>
                <td data-label="Timestamp" class="mono">${formatDate(log.timestamp || log.createdAt)}</td>
                <td data-label="Tool">${escapeHtml(log.tool || '-')}</td>
                <td data-label="Provider">${escapeHtml(log.provider || '-')}</td>
                <td data-label="Status">
                  <span class="badge ${statusBadgeClass(log.status)}">${escapeHtml(log.status || '-')}</span>
                </td>
                <td data-label="Latency" class="mono">${formatDuration(log.latency || log.durationMs)}</td>
                <td data-label="Error" class="cell-truncate" title="${escapeHtml(log.error || '')}">${escapeHtml(log.error || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ${renderPagination(offset, logs.length, hasMore)}
  `;
}

function renderAuditLogs(data) {
  const logs = data.logs || data || [];
  const hasMore = data.hasMore || false;
  const offset = data.offset || 0;

  if (!logs.length) {
    return '<div class="empty-state"><h3>No audit logs found</h3><p>Try widening the time range or removing a filter.</p></div>';
  }

  return `
    <section class="card table-card">
      <div class="section-header section-header-tight">
        <div>
          <p class="section-kicker">Audit</p>
          <h2 class="section-title">Latest admin actions</h2>
          <p class="section-subtitle">Showing ${logs.length} entries from the current page.</p>
        </div>
        <span class="badge ${hasMore ? 'badge-active' : 'badge-disabled'}">${hasMore ? 'More available' : 'Newest page'}</span>
      </div>
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
            ${logs.map((log) => `
              <tr>
                <td data-label="Timestamp" class="mono">${formatDate(log.timestamp || log.createdAt)}</td>
                <td data-label="Action"><span class="table-primary">${escapeHtml(log.action || '-')}</span></td>
                <td data-label="Target" class="mono">${escapeHtml(log.target || '-')}</td>
                <td data-label="Details" class="cell-truncate" title="${escapeHtml(log.details || log.detail || '')}">
                  ${escapeHtml(log.details || log.detail || '-')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ${renderPagination(offset, logs.length, hasMore)}
  `;
}

function renderPagination(offset, count, hasMore) {
  const page = Math.floor(offset / PAGE_SIZE);
  const from = count ? offset + 1 : 0;
  const to = offset + count;

  return `
    <div class="pagination">
      <span>Page ${page + 1} · Showing ${from}-${to}</span>
      <div class="pagination-buttons">
        <button class="btn btn-sm" type="button" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn-sm" type="button" data-page="${page + 1}" ${!hasMore ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;
}

function statusBadgeClass(status) {
  if (status === 'success') return 'badge-active';
  if (status === 'error') return 'badge-revoked';
  return 'badge-disabled';
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
