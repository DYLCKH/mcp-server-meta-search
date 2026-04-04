export function render() {
  return `
    <div id="settings-page">
      <h1>Settings</h1>
      <div id="settings-content">
        <div class="loading"><div class="spinner"></div> Loading...</div>
      </div>
    </div>
  `;
}

export async function init(root, api, state, navigate) {
  const container = root.querySelector('#settings-content');
  let originalSettings = {};

  try {
    const data = await api.getSettings();
    originalSettings = data.settings || data;
    container.innerHTML = renderSettingsForm(originalSettings);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    return;
  }

  // Save
  container.querySelector('#settings-save').addEventListener('click', async () => {
    const form = container.querySelector('#settings-form');
    const formData = new FormData(form);
    const settings = {};

    for (const [key, value] of formData.entries()) {
      settings[key] = parseValue(value);
    }

    const btn = container.querySelector('#settings-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const result = await api.saveSettings(settings);
      originalSettings = result.settings || settings;
      container.innerHTML = renderSettingsForm(originalSettings);
      container.querySelector('.alert-area').innerHTML = '<div class="alert alert-success">Settings saved.</div>';
    } catch (err) {
      container.querySelector('.alert-area').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  // Revert
  container.querySelector('#settings-revert').addEventListener('click', () => {
    container.innerHTML = renderSettingsForm(originalSettings);
  });
}

function renderSettingsForm(settings) {
  const entries = Object.entries(settings);
  if (!entries.length) {
    return '<div class="alert alert-warning">No settings configured.</div>';
  }

  return `
    <form id="settings-form" class="card">
      <div class="alert-area mb-4"></div>
      ${entries.map(([key, value]) => {
        const inputType = typeof value === 'number' ? 'number' : 'text';
        const displayVal = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
        const isObject = typeof value === 'object' && value !== null;

        return `
          <div class="form-group">
            <label for="setting-${escapeHtml(key)}">${escapeHtml(key)}</label>
            ${isObject
              ? `<textarea id="setting-${escapeHtml(key)}" name="${escapeHtml(key)}">${escapeHtml(displayVal)}</textarea>`
              : `<input type="${inputType}" id="setting-${escapeHtml(key)}" name="${escapeHtml(key)}" value="${escapeHtml(displayVal)}">`
            }
          </div>
        `;
      }).join('')}
      <div class="flex gap-2 mt-4">
        <button type="button" class="btn btn-primary" id="settings-save">Save</button>
        <button type="button" class="btn" id="settings-revert">Revert</button>
      </div>
    </form>
  `;
}

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !isNaN(Number(value)) && !value.startsWith('0') && value.length < 16) {
    return Number(value);
  }
  // Try to parse JSON for object fields
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object') return parsed;
  } catch {}
  return value;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
