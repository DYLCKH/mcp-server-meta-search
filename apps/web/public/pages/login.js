export function render(state) {
  if (state.authenticated) {
    return '<div class="loading">Redirecting...</div>';
  }

  return `
    <div class="login-wrapper">
      <div class="login-shell">
        <section class="login-hero">
          <p class="page-kicker">Meta Search</p>
          <h1>Operate the search stack without losing context.</h1>
          <p>
            One control surface for provider health, token lifecycle, runtime settings, and audit visibility.
          </p>
          <div class="login-feature-list">
            <div class="login-feature">
              <strong>Provider posture</strong>
              <span>Inspect active, disabled, and revoked keys instantly.</span>
            </div>
            <div class="login-feature">
              <strong>Live policy</strong>
              <span>Adjust retries, rotation strategy, and recovery timing safely.</span>
            </div>
            <div class="login-feature">
              <strong>Traceability</strong>
              <span>Review request flow and audit history from the same surface.</span>
            </div>
          </div>
        </section>
        <section class="login-panel">
          <div class="login-panel-head">
            <span class="badge badge-active">Admin Access</span>
            <h2>Sign in to continue</h2>
            <p>Use the server-side admin password configured for this environment.</p>
          </div>
          <div id="login-alert"></div>
          <form id="login-form" class="login-form">
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" placeholder="Enter admin password" required autofocus>
            </div>
            <button type="submit" class="btn btn-primary login-submit">Sign In</button>
          </form>
        </section>
      </div>
    </div>
  `;
}

export function init(root, api, state, navigate) {
  const form = root.querySelector('#login-form');
  const alertEl = root.querySelector('#login-alert');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button');
    const password = form.querySelector('#password').value;
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    alertEl.innerHTML = '';

    try {
      await api.login(password);
      state.authenticated = true;
      navigate('#/dashboard');
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
