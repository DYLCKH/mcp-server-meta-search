export function render() {
  return `
    <div id="pats-page" class="page-shell">
      <section class="page-hero">
        <div>
          <p class="page-kicker">Access Tokens</p>
          <h1 class="page-title">Personal access token control</h1>
          <p class="page-description">
            Create client-facing tokens, review expiry posture, and remove stale credentials before they become a risk.
          </p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" id="create-pat-btn" type="button">Create PAT</button>
        </div>
      </section>
      <div id="pats-content" class="section-stack">
        <div class="loading"><div class="spinner"></div> Loading tokens</div>
      </div>
      <div id="modal-root"></div>
    </div>
  `;
}

export async function init(root, api, state) {
  const container = root.querySelector('#pats-content');
  const modalRoot = root.querySelector('#modal-root');

  async function loadPats(createdToken = null) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading tokens</div>';

    try {
      const data = await api.getPats();
      const pats = data.pats || data || [];
      container.innerHTML = renderPatTable(pats);

      if (createdToken) {
        renderCreatedPatNotice(container, createdToken);
      }
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  await loadPats();

  root.querySelector('#create-pat-btn').addEventListener('click', () => {
    showCreateModal(modalRoot, api, state, async (token) => {
      await loadPats(token);
    });
  });

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const name = btn.dataset.name;

    if (action === 'reveal-pat') {
      await handleReveal(container, api, name);
      return;
    }

    if (action === 'toggle-pat') {
      try {
        const enabled = btn.dataset.enabled !== 'true';
        await api.updatePat(name, { enabled });
        state.notify(`Updated PAT "${name}"`, 'success');
        await loadPats();
      } catch (err) {
        state.notify(`Failed to update PAT: ${err.message}`, 'error');
      }
      return;
    }

    if (action === 'delete-pat') {
      if (!confirm(`Delete PAT "${name}" permanently?`)) {
        return;
      }

      try {
        await api.deletePat(name);
        state.notify(`Deleted PAT "${name}"`, 'success');
        await loadPats();
      } catch (err) {
        state.notify(`Failed to delete PAT: ${err.message}`, 'error');
      }
    }
  });
}

function renderPatTable(pats) {
  if (!pats.length) {
    return '<div class="empty-state"><h3>No PATs created yet</h3><p>Create one to authenticate clients against the admin surface.</p></div>';
  }

  const now = Date.now();
  const activeCount = pats.filter((pat) => pat.enabled).length;
  const disabledCount = pats.length - activeCount;
  const expiringSoon = pats.filter((pat) => {
    if (!pat.expiresAt) return false;
    const time = new Date(pat.expiresAt).getTime();
    return time >= now && time <= now + 7 * 24 * 60 * 60 * 1000;
  }).length;

  return `
    <section class="metrics-grid metrics-grid-compact">
      <article class="metric-card">
        <p class="metric-kicker">Active</p>
        <div class="metric-value">${activeCount}</div>
        <p class="metric-label">tokens currently usable</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Disabled</p>
        <div class="metric-value">${disabledCount}</div>
        <p class="metric-label">tokens removed from use</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Expiring Soon</p>
        <div class="metric-value">${expiringSoon}</div>
        <p class="metric-label">tokens expiring within 7 days</p>
      </article>
    </section>

    <section class="card table-card">
      <div class="section-header section-header-tight">
        <div>
          <p class="section-kicker">Inventory</p>
          <h2 class="section-title">Token registry</h2>
          <p class="section-subtitle">Full tokens are only shown at creation time, so copy and store them immediately.</p>
        </div>
      </div>
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
            ${pats.map((pat) => `
              <tr>
                <td data-label="Name">
                  <div class="table-primary">${escapeHtml(pat.name)}</div>
                  <div class="table-subtext">${escapeHtml(pat.note || 'No note provided')}</div>
                </td>
                <td data-label="Prefix" class="mono">${escapeHtml(pat.prefix || '-')}</td>
                <td data-label="Status">
                  <span class="badge ${pat.enabled ? 'badge-active' : 'badge-disabled'}">
                    ${pat.enabled ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td data-label="Created" class="text-muted">${formatDate(pat.createdAt)}</td>
                <td data-label="Last Used" class="text-muted">${formatDate(pat.lastUsedAt)}</td>
                <td data-label="Expires" class="text-muted">${pat.expiresAt ? formatDate(pat.expiresAt) : 'Never'}</td>
                <td data-label="Actions">
                  <div class="table-actions">
                    <button class="btn btn-sm" type="button" data-action="reveal-pat" data-name="${escapeHtml(pat.name)}">Reveal</button>
                    <button class="btn btn-sm" type="button" data-action="toggle-pat" data-name="${escapeHtml(pat.name)}" data-enabled="${String(!!pat.enabled)}">
                      ${pat.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn btn-sm btn-danger" type="button" data-action="delete-pat" data-name="${escapeHtml(pat.name)}">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <div id="pat-reveal-area"></div>
  `;
}

function renderCreatedPatNotice(container, token) {
  const area = container.querySelector('#pat-reveal-area');
  if (!area) return;

  area.innerHTML = `
    <section class="card success-card">
      <div class="section-header section-header-tight">
        <div>
          <p class="section-kicker">Copy Now</p>
          <h2 class="section-title">PAT created successfully</h2>
          <p class="section-subtitle">This is the only time the full token will be shown.</p>
        </div>
      </div>
      <div class="key-value">
        <code>${escapeHtml(token)}</code>
        <button class="btn btn-sm copy-new-pat-btn" type="button">Copy</button>
      </div>
    </section>
  `;

  area.querySelector('.copy-new-pat-btn').addEventListener('click', async function handleCopy() {
    await navigator.clipboard.writeText(token);
    this.textContent = 'Copied';
  });
}

async function handleReveal(container, api, name) {
  const area = container.querySelector('#pat-reveal-area') || container;

  try {
    const data = await api.revealPat(name);
    area.innerHTML = `
      <div class="alert alert-warning">
        <strong>Reveal unavailable:</strong> ${escapeHtml(data.message || 'Full tokens are only returned when the PAT is created.')}
      </div>
    `;
  } catch (err) {
    area.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function showCreateModal(modalRoot, api, state, onDone) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="create-pat-modal">
      <div class="modal">
        <div class="modal-head">
          <p class="section-kicker">New Token</p>
          <h2>Create PAT</h2>
          <p class="modal-copy">The token can be copied once after creation. Expiration is optional but recommended.</p>
        </div>
        <div class="modal-feedback"></div>
        <div class="form-group">
          <label for="pat-name">Name</label>
          <input type="text" id="pat-name" placeholder="e.g. client-ingest" autofocus>
        </div>
        <div class="form-group">
          <label for="pat-note">Note (optional)</label>
          <input type="text" id="pat-note" placeholder="Describe where this token is used">
        </div>
        <div class="form-group">
          <label for="pat-expires">Expiration (optional)</label>
          <input type="datetime-local" id="pat-expires">
        </div>
        <div class="modal-actions">
          <button class="btn" id="modal-cancel" type="button">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm" type="button">Create</button>
        </div>
      </div>
    </div>
  `;

  const overlay = modalRoot.querySelector('#create-pat-modal');
  const feedback = modalRoot.querySelector('.modal-feedback');
  const confirmBtn = modalRoot.querySelector('#modal-confirm');
  const nameInput = modalRoot.querySelector('#pat-name');

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

    const name = nameInput.value.trim();
    const note = modalRoot.querySelector('#pat-note').value.trim() || undefined;
    const expires = modalRoot.querySelector('#pat-expires').value || undefined;

    if (!name) {
      nameInput.focus();
      showError('Name is required.');
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Creating...';

    try {
      const data = await api.createPat({
        name,
        note,
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
      });

      modalRoot.innerHTML = '';
      state.notify(`PAT "${name}" created`, 'success');
      await onDone(data.token);
    } catch (err) {
      showError(err.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Create';
    }
  });

  modalRoot.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
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
