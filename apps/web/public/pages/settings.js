const FIELD_META = {
  key_rotation_strategy: {
    label: 'Key rotation strategy',
    description: 'Choose how the runtime selects among active keys for each request.',
    input: 'select',
    options: [
      { value: 'round_robin', label: 'Round robin' },
      { value: 'random', label: 'Random' },
    ],
  },
  max_attempts_per_request: {
    label: 'Max attempts per request',
    description: 'Upper bound on provider retries before the request is marked failed.',
    input: 'number',
  },
  request_timeout_ms: {
    label: 'Request timeout (ms)',
    description: 'Timeout applied to each upstream provider request.',
    input: 'number',
  },
  key_recovery_interval_ms: {
    label: 'Key recovery interval (ms)',
    description: 'How long a disabled key waits before it becomes eligible again.',
    input: 'number',
  },
  max_disable_before_revoke: {
    label: 'Max disables before revoke',
    description: 'Threshold after which the runtime treats a key as revoked.',
    input: 'number',
  },
};

export function render() {
  return `
    <div id="settings-page" class="page-shell">
      <section class="page-hero">
        <div>
          <p class="page-kicker">Runtime Policy</p>
          <h1 class="page-title">Tune behavior without redeploying</h1>
          <p class="page-description">
            Update retry, timeout, and key lifecycle policy from the admin console. Changes are applied immediately after save.
          </p>
        </div>
      </section>
      <div id="settings-content" class="section-stack">
        <div class="loading"><div class="spinner"></div> Loading settings</div>
      </div>
    </div>
  `;
}

export async function init(root, api, state) {
  const container = root.querySelector('#settings-content');
  let originalSettings = {};
  let saveMessage = '';

  function collectSettings() {
    const form = container.querySelector('#settings-form');
    const formData = new FormData(form);
    const settings = {};

    for (const [key, value] of formData.entries()) {
      settings[key] = parseValue(value);
    }

    return settings;
  }

  function bindForm() {
    container.querySelector('#settings-save').addEventListener('click', async () => {
      const settings = collectSettings();
      const btn = container.querySelector('#settings-save');
      const alertArea = container.querySelector('.alert-area');

      btn.disabled = true;
      btn.textContent = 'Saving...';
      alertArea.innerHTML = '';

      try {
        const result = await api.saveSettings(settings);
        originalSettings = result.settings || settings;
        saveMessage = '<div class="alert alert-success">Settings saved and applied immediately.</div>';
        state.notify('Settings saved', 'success');
        renderSettings();
      } catch (err) {
        alertArea.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = 'Save changes';
      }
    });

    container.querySelector('#settings-revert').addEventListener('click', () => {
      saveMessage = '';
      renderSettings();
    });
  }

  function renderSettings() {
    container.innerHTML = renderSettingsForm(originalSettings);
    if (saveMessage) {
      container.querySelector('.alert-area').innerHTML = saveMessage;
      saveMessage = '';
    }
    bindForm();
  }

  try {
    const data = await api.getSettings();
    originalSettings = data.settings || data;
    renderSettings();
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function renderSettingsForm(settings) {
  const entries = Object.entries(settings);
  if (!entries.length) {
    return '<div class="empty-state"><h3>No settings configured</h3><p>The runtime did not return editable settings.</p></div>';
  }

  const orderedEntries = entries.sort(([left], [right]) => {
    const leftIndex = Object.keys(FIELD_META).indexOf(left);
    const rightIndex = Object.keys(FIELD_META).indexOf(right);
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });

  return `
    <section class="metrics-grid metrics-grid-compact">
      <article class="metric-card">
        <p class="metric-kicker">Rotation</p>
        <div class="metric-value metric-value-small">${escapeHtml(formatStrategy(settings.key_rotation_strategy))}</div>
        <p class="metric-label">current selection policy</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Timeout</p>
        <div class="metric-value">${settings.request_timeout_ms ?? '-'}</div>
        <p class="metric-label">milliseconds per request</p>
      </article>
      <article class="metric-card">
        <p class="metric-kicker">Retries</p>
        <div class="metric-value">${settings.max_attempts_per_request ?? '-'}</div>
        <p class="metric-label">maximum attempts per request</p>
      </article>
    </section>

    <form id="settings-form" class="card">
      <div class="section-header">
        <div>
          <p class="section-kicker">Editable Policy</p>
          <h2 class="section-title">Runtime controls</h2>
          <p class="section-subtitle">Use the revert button to restore the last values loaded from the server.</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" id="settings-save">Save changes</button>
          <button type="button" class="btn" id="settings-revert">Revert</button>
        </div>
      </div>
      <div class="alert-area"></div>
      <div class="settings-grid">
        ${orderedEntries.map(([key, value]) => renderField(key, value)).join('')}
      </div>
    </form>
  `;
}

function renderField(key, value) {
  const meta = FIELD_META[key] || {
    label: key,
    description: 'Generic configuration value.',
    input: typeof value === 'number' ? 'number' : 'text',
  };
  const displayValue = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? '');

  return `
    <div class="setting-card">
      <label for="setting-${escapeHtml(key)}">${escapeHtml(meta.label)}</label>
      ${renderFieldInput(key, value, meta, displayValue)}
      <p class="field-hint">${escapeHtml(meta.description)}</p>
    </div>
  `;
}

function renderFieldInput(key, value, meta, displayValue) {
  if (meta.input === 'select') {
    return `
      <select id="setting-${escapeHtml(key)}" name="${escapeHtml(key)}">
        ${meta.options.map((option) => `
          <option value="${escapeHtml(option.value)}" ${option.value === value ? 'selected' : ''}>
            ${escapeHtml(option.label)}
          </option>
        `).join('')}
      </select>
    `;
  }

  if (typeof value === 'object' && value !== null) {
    return `<textarea id="setting-${escapeHtml(key)}" name="${escapeHtml(key)}">${escapeHtml(displayValue)}</textarea>`;
  }

  return `
    <input
      type="${meta.input === 'number' ? 'number' : 'text'}"
      id="setting-${escapeHtml(key)}"
      name="${escapeHtml(key)}"
      value="${escapeHtml(displayValue)}"
    >
  `;
}

function formatStrategy(value) {
  if (value === 'round_robin') return 'Round robin';
  if (value === 'random') return 'Random';
  return value || '-';
}

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value)) && !value.startsWith('0') && value.length < 16) {
    return Number(value);
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object') return parsed;
  } catch {}

  return value;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
