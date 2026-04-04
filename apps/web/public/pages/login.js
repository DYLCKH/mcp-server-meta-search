export function render(state) {
  if (state.authenticated) {
    // Already authenticated, will redirect
    return '<div class="loading">Redirecting...</div>';
  }
  return `
    <div class="login-wrapper">
      <div class="login-box">
        <h1>Meta Search Admin</h1>
        <div id="login-alert"></div>
        <form id="login-form">
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="Enter admin password" required autofocus>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Sign In</button>
        </form>
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
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}
