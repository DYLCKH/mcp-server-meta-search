export function render() {
  return `
    <div id="providers-page" class="page-shell">
      <section class="page-hero">
        <div>
          <p class="page-kicker">Provider Pools</p>
          <h1 class="page-title">Keep key capacity healthy</h1>
          <p class="page-description">
            Inspect each provider pool, add fresh credentials, and isolate degraded keys before they impact traffic.
          </p>
        </div>
      </section>
      <div id="providers-content" class="section-stack">
        <div class="loading"><div class="spinner"></div> Loading providers</div>
      </div>
      <div id="modal-root"></div>
    </div>
  `;
}

export async function init(root, api, state) {
  const container = root.querySelector('#providers-content');
  const modalRoot = root.querySelector('#modal-root');
  let providerMap = new Map();

  try {
    const data = await api.getProviders();
    const providers = data.providers || data || [];
    providerMap = new Map(providers.map((provider) => [provider.name, provider]));
    container.innerHTML = renderProviders(providers);

    container.querySelectorAll('.provider-tab').forEach((tab) => {
      tab.addEventListener('click', async () => {
        container.querySelectorAll('.provider-tab').forEach((item) => item.classList.remove('active'));
        tab.classList.add('active');
        await loadProviderDetails(container, api, tab.dataset.name, providerMap.get(tab.dataset.name));
      });
    });

    const firstTab = container.querySelector('.provider-tab');
    if (firstTab) {
      firstTab.classList.add('active');
      await loadProviderDetails(container, api, firstTab.dataset.name, providerMap.get(firstTab.dataset.name));
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Failed to load providers: ${escapeHtml(err.message)}</div>`;
  }

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const provider = btn.dataset.provider;
    const index = Number.parseInt(btn.dataset.index ?? '-1', 10);

    if (action === 'add-key') {
      showAddKeyModal(modalRoot, api, state, provider, async () => {
        await loadProviderDetails(container, api, provider, providerMap.get(provider));
      });
      return;
    }

    if (action === 'toggle-key') {
      try {
        const enabled = btn.dataset.enabled !== 'true';
        await api.updateKey(provider, index, { enabled });
        state.notify(`Updated ${provider} key state`, 'success');
        await loadProviderDetails(container, api, provider, providerMap.get(provider));
      } catch (err) {
        state.notify(`Failed to update key: ${err.message}`, 'error');
      }
      return;
    }

    if (action === 'delete-key') {
      if (!confirm('Delete this API key permanently?')) {
        return;
      }

      try {
        await api.deleteKey(provider, index);
        state.notify(`Deleted key from ${provider}`, 'success');
        await loadProviderDetails(container, api, provider, providerMap.get(provider));
      } catch (err) {
        state.notify(`Failed to delete key: ${err.message}`, 'error');
      }
    }
  });
}

function renderProviders(providers) {
  if (!providers.length) {
    return '<div class="empty-state"><h3>No providers configured</h3><p>Add provider credentials to enable routing.</p></div>';
  }

  return `
    <section class="card">
      <div class="section-header">
        <div>
          <p class="section-kicker">Select Provider</p>
          <h2 class="section-title">Credential pools</h2>
          <p class="section-subtitle">Each tile shows current key posture before you open the detailed pool view.</p>
        </div>
      </div>
      <div class="provider-tabs">
        ${providers.map((provider) => renderProviderTab(provider)).join('')}
      </div>
    </section>
    <div id="provider-details" class="section-stack"></div>
  `;
}

function renderProviderTab(provider) {
  const active = provider.activeKeys || 0;
  const total = provider.total || 0;
  const healthy = active > 0;

  return `
    <button type="button" class="provider-tab" data-name="${escapeHtml(provider.name)}">
      <span class="provider-tab-top">
        <strong class="provider-tab-name">${escapeHtml(provider.name)}</strong>
        <span class="badge ${healthy ? 'badge-active' : 'badge-disabled'}">${healthy ? 'Healthy' : 'Attention'}</span>
      </span>
      <span class="provider-tab-meta">${total} keys · ${active} active</span>
    </button>
  `;
}

async function loadProviderDetails(container, api, name, summary) {
  const details = container.querySelector('#provider-details');
  details.innerHTML = '<div class="loading"><div class="spinner"></div> Loading provider details</div>';

  try {
    const data = await api.getProvider(name);
    const keys = data.keys || [];
    const total = summary?.total ?? data.total ?? keys.length;
    const active = summary?.activeKeys ?? summary?.active ?? keys.filter((key) => key.status === 'active').length;
    const disabled = summary?.disabledKeys ?? summary?.disabled ?? keys.filter((key) => key.status === 'disabled').length;
    const revoked = summary?.revokedKeys ?? summary?.revoked ?? keys.filter((key) => key.status === 'revoked').length;

    details.innerHTML = `
      <section class="card">
        <div class="section-header">
          <div>
            <p class="section-kicker">${escapeHtml(name)}</p>
            <h2 class="section-title">${escapeHtml(name)} key pool</h2>
            <p class="section-subtitle">Rotate or disable keys here without editing the configuration file by hand.</p>
            <div class="info-pills">
              ${renderInfoPill('Total keys', total)}
              ${renderInfoPill('Active', active, 'active')}
              ${renderInfoPill('Disabled', disabled, 'warning')}
              ${renderInfoPill('Revoked', revoked, 'danger')}
            </div>
          </div>
          <button class="btn btn-primary" type="button" data-action="add-key" data-provider="${escapeHtml(name)}">Add Key</button>
        </div>
        ${keys.length
          ? `<div class="key-list">${keys.map((key, index) => renderKeyCard(name, key, index)).join('')}</div>`
          : `<div class="empty-state">
              <h3>No keys configured</h3>
              <p>Add a new key to start serving traffic through this provider.</p>
            </div>`}
      </section>
    `;
  } catch (err) {
    details.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function renderKeyCard(providerName, key, index) {
  const status = key.status || (key.enabled ? 'active' : 'disabled');
  const badgeClass =
    status === 'revoked'
      ? 'badge-revoked'
      : status === 'active'
        ? 'badge-active'
        : 'badge-disabled';
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const detailCopy =
    status === 'revoked'
      ? 'Revoked keys are blocked from re-entry. Replace them with a fresh credential.'
      : key.enabled
        ? 'Currently eligible to receive traffic.'
        : 'Held out of rotation until you re-enable it.';

  return `
    <article class="key-card">
      <div class="key-card-main">
        <div class="key-card-title">
          <span class="status-dot ${status}"></span>
          <div>
            <strong class="code-text">${escapeHtml(key.masked || '***')}</strong>
            <p>${detailCopy}</p>
          </div>
        </div>
        <div class="key-card-meta">
          <span class="badge ${badgeClass}">${statusLabel}</span>
          <span class="key-card-timestamp">${key.lastUsed ? `Last used ${formatDate(key.lastUsed)}` : 'No usage recorded yet'}</span>
        </div>
      </div>
      <div class="key-actions">
        <button
          class="btn btn-sm"
          type="button"
          data-action="toggle-key"
          data-provider="${escapeHtml(providerName)}"
          data-index="${index}"
          data-enabled="${String(!!key.enabled)}"
          ${status === 'revoked' ? 'disabled' : ''}
        >
          ${key.enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          class="btn btn-sm btn-danger"
          type="button"
          data-action="delete-key"
          data-provider="${escapeHtml(providerName)}"
          data-index="${index}"
        >
          Delete
        </button>
      </div>
    </article>
  `;
}

function renderInfoPill(label, value, tone = 'neutral') {
  return `
    <div class="info-pill info-pill-${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function showAddKeyModal(modalRoot, api, state, provider, onDone) {
  const isCloudflare = provider === 'cloudflare';

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="add-key-modal">
      <div class="modal">
        <div class="modal-head">
          <p class="section-kicker">New Credential</p>
          <h2>Add key for ${escapeHtml(provider)}</h2>
          <p class="modal-copy">This updates the runtime config immediately after validation succeeds.</p>
        </div>
        <div class="modal-feedback"></div>
        ${isCloudflare ? `
          <div class="form-group">
            <label for="cf-account-id">Account ID</label>
            <input type="text" id="cf-account-id" placeholder="Enter Cloudflare account ID" autofocus>
          </div>
          <div class="form-group">
            <label for="cf-api-token">API Token</label>
            <input type="text" id="cf-api-token" placeholder="Enter Cloudflare API token">
          </div>
        ` : `
          <div class="form-group">
            <label for="new-key-input">API Key</label>
            <input type="text" id="new-key-input" placeholder="Enter API key" autofocus>
          </div>
        `}
        <div class="modal-actions">
          <button class="btn" id="modal-cancel" type="button">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm" type="button">Add Key</button>
        </div>
      </div>
    </div>
  `;

  const overlay = modalRoot.querySelector('#add-key-modal');
  const feedback = modalRoot.querySelector('.modal-feedback');
  const input = modalRoot.querySelector('#new-key-input');
  const accountIdInput = modalRoot.querySelector('#cf-account-id');
  const apiTokenInput = modalRoot.querySelector('#cf-api-token');
  const confirmBtn = modalRoot.querySelector('#modal-confirm');

  const showError = (message) => {
    feedback.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
  };

  modalRoot.querySelector('#modal-cancel').addEventListener('click', () => {
    modalRoot.innerHTML = '';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      modalRoot.innerHTML = '';
    }
  });

  confirmBtn.addEventListener('click', async () => {
    feedback.innerHTML = '';

    const key = isCloudflare
      ? {
          account_id: accountIdInput.value.trim(),
          api_token: apiTokenInput.value.trim(),
        }
      : input.value.trim();

    if (isCloudflare) {
      if (!key.account_id) {
        accountIdInput.focus();
        showError('Account ID is required.');
        return;
      }
      if (!key.api_token) {
        apiTokenInput.focus();
        showError('API token is required.');
        return;
      }
    } else if (!key) {
      input.focus();
      showError('API key is required.');
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Adding...';

    try {
      await api.addKey(provider, key);
      modalRoot.innerHTML = '';
      state.notify(`${provider} key added`, 'success');
      await onDone();
    } catch (err) {
      showError(err.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Add Key';
    }
  });

  [input, accountIdInput, apiTokenInput].filter(Boolean).forEach((field) => {
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      }
    });
  });
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
