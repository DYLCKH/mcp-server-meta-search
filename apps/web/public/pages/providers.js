export function render() {
  return `
    <div id="providers-page">
      <div class="card-header">
        <h1>Providers</h1>
      </div>
      <div id="providers-content">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
      <div id="modal-root"></div>
    </div>
  `;
}

export async function init(root, api, state, navigate) {
  const container = root.querySelector('#providers-content');
  const modalRoot = root.querySelector('#modal-root');

  try {
    const data = await api.getProviders();
    const providers = data.providers || data || [];
    container.innerHTML = renderProviders(providers);

    // Provider tab clicks
    container.querySelectorAll('.provider-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        container.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        await loadProviderDetails(container, api, tab.dataset.name);
      });
    });

    // Auto-select first provider
    const firstTab = container.querySelector('.provider-tab');
    if (firstTab) {
      firstTab.classList.add('active');
      await loadProviderDetails(container, api, firstTab.dataset.name);
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">Failed to load providers: ${escapeHtml(err.message)}</div>`;
  }

  // Delegated event handling for key actions
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const provider = btn.dataset.provider;
    const index = parseInt(btn.dataset.index);

    if (action === 'add-key') {
      showAddKeyModal(modalRoot, api, provider, () => {
        loadProviderDetails(container, api, provider);
      });
    } else if (action === 'toggle-key') {
      try {
        const enabled = btn.dataset.enabled !== 'true';
        await api.updateKey(provider, index, { enabled });
        await loadProviderDetails(container, api, provider);
      } catch (err) {
        alert('Failed to update key: ' + err.message);
      }
    } else if (action === 'delete-key') {
      if (confirm('Delete this API key permanently?')) {
        try {
          await api.deleteKey(provider, index);
          await loadProviderDetails(container, api, provider);
        } catch (err) {
          alert('Failed to delete key: ' + err.message);
        }
      }
    }
  });
}

function renderProviders(providers) {
  if (!providers.length) {
    return '<div class="alert alert-warning">No providers configured.</div>';
  }

  return `
    <div class="tabs">
      ${providers.map(p => `
        <button class="tab provider-tab" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>
      `).join('')}
    </div>
    <div id="provider-details"></div>
  `;
}

async function loadProviderDetails(container, api, name) {
  const details = container.querySelector('#provider-details');
  details.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const data = await api.getProvider(name);
    const keys = data.keys || [];
    details.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2 style="margin:0">${escapeHtml(name)} Keys</h2>
          <button class="btn btn-primary btn-sm" data-action="add-key" data-provider="${escapeHtml(name)}">Add Key</button>
        </div>
        ${keys.length === 0 ? '<p class="text-muted">No keys configured.</p>' : keys.map((key, i) => `
          <div class="key-row">
            <div class="key-info">
              <span class="status-dot ${key.status || (key.enabled ? 'active' : 'disabled')}"></span>
              <code class="text-mono">${escapeHtml(key.masked || key.key || '***')}</code>
              ${key.lastUsed ? `<span class="text-muted" style="font-size:12px">last used ${formatDate(key.lastUsed)}</span>` : ''}
            </div>
            <div class="key-actions">
              <button class="btn btn-sm" data-action="toggle-key" data-provider="${escapeHtml(name)}" data-index="${i}" data-enabled="${!!key.enabled}">
                ${key.enabled ? 'Disable' : 'Enable'}
              </button>
              <button class="btn btn-sm btn-danger" data-action="delete-key" data-provider="${escapeHtml(name)}" data-index="${i}">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    details.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function showAddKeyModal(modalRoot, api, provider, onDone) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="add-key-modal">
      <div class="modal">
        <h2>Add API Key for ${escapeHtml(provider)}</h2>
        <div class="form-group">
          <label for="new-key-input">API Key</label>
          <input type="text" id="new-key-input" placeholder="Enter API key" autofocus>
        </div>
        <div class="modal-actions">
          <button class="btn" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm">Add Key</button>
        </div>
      </div>
    </div>
  `;

  const overlay = modalRoot.querySelector('#add-key-modal');
  const input = modalRoot.querySelector('#new-key-input');

  modalRoot.querySelector('#modal-cancel').addEventListener('click', () => { modalRoot.innerHTML = ''; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) modalRoot.innerHTML = ''; });

  modalRoot.querySelector('#modal-confirm').addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { input.focus(); return; }
    try {
      await api.addKey(provider, key);
      modalRoot.innerHTML = '';
      onDone();
    } catch (err) {
      alert('Failed to add key: ' + err.message);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modalRoot.querySelector('#modal-confirm').click();
  });
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
