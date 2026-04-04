export function render() {
  return `
    <div id="pats-page">
      <div class="card-header">
        <h1>Personal Access Tokens</h1>
        <button class="btn btn-primary" id="create-pat-btn">Create PAT</button>
      </div>
      <div id="pats-content">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
      <div id="modal-root"></div>
    </div>
  `;
}

export async function init(root, api, state, navigate) {
  const container = root.querySelector('#pats-content');
  const modalRoot = root.querySelector('#modal-root');

  async function loadPats() {
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const data = await api.getPats();
      const pats = data.pats || data || [];
      container.innerHTML = renderPatTable(pats);
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  await loadPats();

  // Create PAT button
  root.querySelector('#create-pat-btn').addEventListener('click', () => {
    showCreateModal(modalRoot, api, loadPats);
  });

  // Delegated events
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const name = btn.dataset.name;

    if (action === 'reveal-pat') {
      await handleReveal(container, api, name);
    } else if (action === 'toggle-pat') {
      try {
        const enabled = btn.dataset.enabled !== 'true';
        await api.updatePat(name, { enabled });
        await loadPats();
      } catch (err) {
        alert('Failed to update PAT: ' + err.message);
      }
    } else if (action === 'delete-pat') {
      if (confirm(`Delete PAT "${name}" permanently?`)) {
        try {
          await api.deletePat(name);
          await loadPats();
        } catch (err) {
          alert('Failed to delete PAT: ' + err.message);
        }
      }
    }
  });
}

function renderPatTable(pats) {
  if (!pats.length) {
    return '<div class="alert alert-warning">No PATs created yet.</div>';
  }

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Used</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pats.map(pat => `
              <tr>
                <td><strong>${escapeHtml(pat.name)}</strong></td>
                <td class="mono">${escapeHtml(pat.prefix || '-')}</td>
                <td>
                  <span class="badge ${pat.enabled ? 'badge-active' : 'badge-disabled'}">
                    ${pat.enabled ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td class="text-muted">${formatDate(pat.createdAt)}</td>
                <td class="text-muted">${formatDate(pat.lastUsedAt)}</td>
                <td class="text-muted">${pat.expiresAt ? formatDate(pat.expiresAt) : 'Never'}</td>
                <td>
                  <div class="flex gap-2">
                    <button class="btn btn-sm" data-action="reveal-pat" data-name="${escapeHtml(pat.name)}">Reveal</button>
                    <button class="btn btn-sm" data-action="toggle-pat" data-name="${escapeHtml(pat.name)}" data-enabled="${!!pat.enabled}">
                      ${pat.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn btn-sm btn-danger" data-action="delete-pat" data-name="${escapeHtml(pat.name)}">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div id="pat-reveal-area"></div>
  `;
}

async function handleReveal(container, api, name) {
  const area = container.querySelector('#pat-reveal-area') || container;
  try {
    const data = await api.revealPat(name);
    area.innerHTML = `
      <div class="alert alert-warning mt-4">
        <strong>Warning:</strong> This token will only be shown once. Copy it now.
        <div class="key-value mt-2">
          <code style="flex:1">${escapeHtml(data.token)}</code>
          <button class="btn btn-sm" id="copy-pat-btn">Copy</button>
        </div>
      </div>
    `;
    area.querySelector('#copy-pat-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(data.token).then(() => {
        area.querySelector('#copy-pat-btn').textContent = 'Copied!';
      });
    });
  } catch (err) {
    area.innerHTML = `<div class="alert alert-error mt-4">${escapeHtml(err.message)}</div>`;
  }
}

function showCreateModal(modalRoot, api, onDone) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="create-pat-modal">
      <div class="modal">
        <h2>Create PAT</h2>
        <div class="form-group">
          <label for="pat-name">Name</label>
          <input type="text" id="pat-name" placeholder="e.g. my-token" autofocus>
        </div>
        <div class="form-group">
          <label for="pat-note">Note (optional)</label>
          <input type="text" id="pat-note" placeholder="Description">
        </div>
        <div class="form-group">
          <label for="pat-expires">Expiration (optional)</label>
          <input type="datetime-local" id="pat-expires">
        </div>
        <div class="modal-actions">
          <button class="btn" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm">Create</button>
        </div>
      </div>
    </div>
  `;

  const overlay = modalRoot.querySelector('#create-pat-modal');

  modalRoot.querySelector('#modal-cancel').addEventListener('click', () => { modalRoot.innerHTML = ''; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) modalRoot.innerHTML = ''; });

  modalRoot.querySelector('#modal-confirm').addEventListener('click', async () => {
    const name = modalRoot.querySelector('#pat-name').value.trim();
    const note = modalRoot.querySelector('#pat-note').value.trim() || undefined;
    const expires = modalRoot.querySelector('#pat-expires').value || undefined;

    if (!name) { modalRoot.querySelector('#pat-name').focus(); return; }

    try {
      const data = await api.createPat({ name, note, expiresAt: expires ? new Date(expires).toISOString() : undefined });
      modalRoot.innerHTML = '';

      // Show the token
      const alert = document.createElement('div');
      alert.className = 'alert alert-success mt-4';
      alert.innerHTML = `
        <strong>PAT created successfully!</strong> Copy the token now - it won't be shown again.
        <div class="key-value mt-2">
          <code style="flex:1">${escapeHtml(data.token)}</code>
          <button class="btn btn-sm copy-new-pat-btn">Copy</button>
        </div>
      `;
      const contentEl = document.getElementById('pats-content') || document.getElementById('page-content');
      contentEl.prepend(alert);
      alert.querySelector('.copy-new-pat-btn').addEventListener('click', function() {
        navigator.clipboard.writeText(data.token).then(() => { this.textContent = 'Copied!'; });
      });

      await onDone();
    } catch (err) {
      alert('Failed to create PAT: ' + err.message);
    }
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
