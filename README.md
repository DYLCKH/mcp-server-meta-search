# Meta Search MCP Server

A remote MCP (Model Context Protocol) server providing web search and page fetching tools with automatic API key rotation, key health tracking, and an admin dashboard.

Built as a modular monolith:

```
packages/
  shared/    -- shared utilities (schemas, helpers)
  config/    -- JSONC config loading, validation, atomic writes
  runtime/   -- key pool, rotation, performance middleware
apps/
  server/    -- HTTP server, MCP transport, admin API, DB layer
  web/       -- Admin WebUI (static SPA)
```

## Features

- **5 MCP tools**: Tavily, Exa, Perplexity search + Jina/Cloudflare fetch
- **Automatic key rotation** with round-robin or random strategy
- **Key health tracking**: automatic disable, recovery, and revocation
- **PAT authentication** for MCP tool calls (Bearer token)
- **Admin API & WebUI**: key management, PAT management, logs, settings, hot reload
- **Performance**: in-memory cache, concurrency limiter, circuit breaker, single-flight dedup, Prometheus metrics
- **SQLite logging**: request logs and audit trail with batched writes
- **Config hot reload**: update settings without restart via Admin API
- **OTA self-update**: download fixed-tag release assets directly and restart in place
- **Streamable HTTP transport**: standard MCP over HTTP POST

## Quick Start

### Local Development

```bash
# Prerequisites: Bun >= 1.3

# Clone and install
git clone https://github.com/lieyan666/mcp-server-meta-search.git
cd mcp-server-meta-search
bun install

# Copy and edit config
cp config.jsonc.example config.jsonc
# Edit config.jsonc with your API keys

# Build and run
bun run build
bun run dev
```

`bun run dev` now starts both the API server and the admin WebUI, and it will
pick the next free port automatically if `3000` or `5173` is already in use.

### Single-Binary Build

```bash
# Current platform
bun run build:binary

# Specific release target
bun run build:binary --target bun-linux-x64
```

### Manual Build

```bash
bun install --frozen-lockfile
bun run build
bun run start
```

## Configuration

The server uses **JSONC** (`config.jsonc`) as its primary configuration format. See [`config.jsonc.example`](config.jsonc.example) for the full annotated reference.

### Config Resolution Order

1. Load `config.jsonc` (path from `CONFIG_PATH` env var, defaults to `./config.jsonc`)
2. Validate the file and apply built-in defaults for omitted fields

### Environment Variables

#### Server

| Env Var | Default | Description |
|---------|---------|-------------|
| `CONFIG_PATH` | `./config.jsonc` | Path to config file |
| `LOGS_DB_PATH` | `./logs.db` | Path to SQLite database |
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `NODE_ENV` | — | Set to `production` for secure cookies |

### All Config Fields

| Field | Default | Description |
|-------|---------|-------------|
| `tavily.api_keys` | — | Tavily API key(s) |
| `tavily.base_url` | `https://api.tavily.com` | Tavily API base URL |
| `exa.api_keys` | — | Exa API key(s) |
| `exa.base_url` | `https://api.exa.ai` | Exa API base URL |
| `perplexity.api_keys` | — | Perplexity API key(s) |
| `perplexity.base_url` | `https://api.perplexity.ai` | Perplexity API base URL |
| `jina.api_keys` | — | Optional Jina Reader API key(s) |
| `jina.base_url` | `https://r.jina.ai` | Jina Reader base URL |
| `cloudflare.accounts` | — | `[{account_id, api_token}]` pairs |
| `cloudflare.base_url` | `https://api.cloudflare.com/client/v4` | Cloudflare API base URL |
| `key_rotation_strategy` | `round_robin` | `round_robin` or `random` |
| `max_attempts_per_request` | `0` | Max retries (`0` = try each key once) |
| `request_timeout_ms` | `30000` | Request timeout in ms |
| `key_recovery_interval_ms` | `300000` | Time before disabled key retries (5 min) |
| `max_disable_before_revoke` | `3` | Failures before permanent revocation |
| `invalid_keys_file` | `invalid-keys.json` | File path for revoked keys |
| `ota.enabled` | `true` | Enable Admin API/WebUI self-update operations |
| `ota.repository` | `lieyan666/mcp-server-meta-search` | GitHub `owner/repo` used for static release downloads |
| `ota.tag` | `dev` | Release tag to download from |
| `ota.asset_name` | platform binary | Optional release asset name override |
| `ota.version_url` | release `version.txt` | Optional version file URL override |
| `ota.binary_path` | current binary | Optional install target override |
| `ota.restart_strategy` | `self` | `self` starts the new binary; `exit` lets a supervisor restart |
| `admin.password` | — | Plaintext password (transient). Hashed to `password_hash` on startup, then removed from the file. |
| `admin.password_hash` | — | Argon2id-encoded password hash. Written automatically; legacy SHA-256 hex still accepted and auto-upgraded on next login. |
| `admin.session_secret` | — | Secret for signing session cookies |
| `admin.session_ttl_ms` | `86400000` | Session TTL (24 hours) |
| `pats` | `[]` | Personal access tokens array |
| `performance.cache.enabled` | `true` | Enable response caching |
| `performance.cache.maxSize` | `128` | Max cached entries |
| `performance.cache.maxBytes` | `8388608` | Approximate total in-memory cache budget |
| `performance.cache.maxEntryBytes` | `262144` | Skip caching entries above this size |
| `performance.cache.defaultTtlMs` | `60000` | Cache TTL (60 seconds) |
| `performance.concurrency.maxConcurrency` | `8` | Max parallel provider requests |
| `performance.concurrency.maxQueueSize` | `64` | Max queued requests |
| `performance.concurrency.queueTimeoutMs` | `30000` | Queue wait timeout |
| `performance.circuitBreaker.enabled` | `true` | Enable circuit breaker |
| `performance.circuitBreaker.failureThreshold` | `5` | Failures before circuit opens |
| `performance.circuitBreaker.resetTimeoutMs` | `30000` | Time before circuit retry |
| `performance.singleFlight.enabled` | `true` | Enable single-flight dedup |

## Authentication

### MCP Tool Calls (PAT)

Personal Access Tokens (PATs) authenticate MCP tool calls via the `Authorization` header:

```
Authorization: Bearer ms_pat_xxxxxxxxxxxxxxxx
```

When PATs are configured, all requests to `POST /mcp` require a valid Bearer token. When no PATs exist, the MCP endpoint is open (no auth required).

Manage PATs through the Admin API or WebUI.

### Admin Panel (Session)

The admin panel uses signed cookie-based session authentication.

**Setting the admin password**:

1. Edit `config.jsonc` and set `admin.password` to a plaintext password, plus a random `admin.session_secret` (≥32 chars).
2. Start the server. On boot it hashes the password with **argon2id**, writes the result to `admin.password_hash`, and removes the plaintext `password` field from the file.
3. Repeat any time you need to rotate: set `admin.password` again and restart.

Passwords are never stored in plaintext after the first launch. Legacy SHA-256 hashes from older versions are still accepted for login and will be transparently upgraded to argon2id on the next successful login.

## MCP Tools

| Tool | Provider | Description |
|------|----------|-------------|
| `search_tavily` | [Tavily](https://tavily.com/) | General-purpose web search with AI answer generation |
| `search_exa` | [Exa](https://exa.ai/) | AI-native search with neural, keyword, and hybrid modes |
| `search_perplexity` | [Perplexity](https://perplexity.ai/) | Lightweight structured web search |
| `fetch_jina_markdown` | [Jina Reader](https://jina.ai/reader/) | Default lightweight Markdown fetch for most pages |
| `fetch_as_markdown` | [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) | Browser-rendered Markdown fallback for JS-heavy pages |

### Client Configuration

Connect from an MCP client (e.g., Claude, OpenCode) using Streamable HTTP transport:

```jsonc
{
  "mcpServers": {
    "meta-search": {
      "type": "streamableHttp",
      "url": "https://your-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ms_pat_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## API Reference

### MCP Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/mcp` | PAT | MCP Streamable HTTP transport endpoint |

### Health & Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Liveness probe (returns `OK` / 200) |
| `GET` | `/readyz` | Readiness probe (returns `OK` / 200 or `Not ready` / 503) |
| `GET` | `/metrics` | Prometheus-format metrics (cache, circuit breaker, concurrency) |

### Admin API

All `/api/admin/*` routes (except login/logout) require an authenticated admin session cookie.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/auth/login` | Login with `{password}`, returns session cookie |
| `POST` | `/api/admin/auth/logout` | Invalidate session |
| `GET` | `/api/admin/dashboard` | Dashboard summary (provider key counts, PAT count) |
| `GET` | `/api/admin/providers` | List all providers with key health stats |
| `GET` | `/api/admin/providers/:name` | Provider detail with per-key health |
| `POST` | `/api/admin/providers/:name/keys` | Add a key (`{api_key: "..."}`) |
| `PUT` | `/api/admin/providers/:name/keys/:index` | Update key (`{disabled: true/false}`) |
| `DELETE` | `/api/admin/providers/:name/keys/:index` | Remove a key |
| `POST` | `/api/admin/providers/:name/keys/:index/check` | Get key health status |
| `GET` | `/api/admin/pats` | List PATs (masked) |
| `POST` | `/api/admin/pats` | Create PAT (`{name, note?, expires_at?}`) |
| `GET` | `/api/admin/pats/:name` | PAT detail |
| `PUT` | `/api/admin/pats/:name` | Update PAT (`{disabled?, note?, expires_at?}`) |
| `DELETE` | `/api/admin/pats/:name` | Delete PAT |
| `POST` | `/api/admin/pats/:name/reveal` | Log reveal attempt (token not recoverable) |
| `GET` | `/api/admin/settings` | Current global settings |
| `PUT` | `/api/admin/settings` | Update settings (triggers hot reload) |
| `POST` | `/api/admin/reload` | Reload config from disk and apply |
| `GET` | `/api/admin/ota/status` | Current OTA config, local version, and release URLs |
| `POST` | `/api/admin/ota/check` | Fetch remote `version.txt` and compare with local version |
| `POST` | `/api/admin/ota/update` | Download, replace binary, and restart (`{force?, restart?}`) |
| `GET` | `/api/admin/logs/requests` | MCP request logs (query: tool, provider, status, from, to, limit, offset) |
| `GET` | `/api/admin/logs/audit` | Audit logs (query: action, target, target_type, from, to, limit, offset) |

### WebUI

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/app` | Admin dashboard SPA |
| `GET` | `/app/*` | Static assets (SPA with fallback routing) |

## OTA Self-Update

OTA is enabled by default and uses the repository's rolling `dev` release.
Publish the binary as a release asset under the configured tag. The default
tag is `dev`, and the server downloads directly from static release URLs such
as:

```
https://github.com/lieyan666/mcp-server-meta-search/releases/download/dev/meta-search-linux-x64
```

No GitHub API calls are made, so normal GitHub API rate limits are avoided.
Publish a `version.txt` asset beside the binary to let `/api/admin/ota/check`
skip installs when the local version matches the release. The server also
checks `versions.txt` and `versons.txt` aliases. Without a version file,
`/api/admin/ota/update` requires `{ "force": true }`.

When running under a process manager, set `"restart_strategy": "exit"` and let
the supervisor restart the updated binary. With the default `"self"` strategy,
the server starts the updated binary after the current process exits.

## Key Rotation & Health Tracking

### Rotation

Each provider supports multiple API keys rotated automatically on failure.

- **Strategy:** `round_robin` (default) or `random`
- **Retry triggers:** HTTP 401, 402, 403, 408, 409, 425, 429, 432, 433, 500, 502, 503, 504, network timeouts, connection errors

### Key Health State Machine

```
active --(auth error 401/402/403)--> disabled --(recovery timeout)--> active
                                          |
                                   (disable count >= max)
                                          |
                                          v
                                       revoked  -->  written to invalid-keys.json
```

- **`active`** -- key is available for use
- **`disabled`** -- temporarily removed after auth error; auto-recovered after `key_recovery_interval_ms`
- **`revoked`** -- permanently removed after `max_disable_before_revoke` cumulative failures; recorded to `invalid_keys_file`

## Deployment

Docker packaging is no longer maintained. The supported deployment targets are:

- running the built server with Bun
- shipping a Bun-compiled single binary

### Binary Deployment

```bash
bun install --frozen-lockfile
bun run build:binary --target bun-linux-x64

# Start the compiled server
./dist-bin/meta-search-linux-x64
```

The binary reads the same `CONFIG_PATH`, `LOGS_DB_PATH`, `PORT`, and `HOST`
environment variables as the source-mode server.

For memory-constrained hosts, prefer the single binary. On a 128 MB instance,
keep cache byte limits enabled unless you have measured spare headroom.

### Reverse Proxy

#### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name search.example.com;

    ssl_certificate     /etc/ssl/search.example.com.pem;
    ssl_certificate_key /etc/ssl/search.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # MCP Streamable HTTP may use long-lived connections
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

#### Caddy

```
search.example.com {
    reverse_proxy localhost:3000
}
```

### HTTPS / CDN with Cloudflare

1. Add your domain to Cloudflare and point DNS to your server
2. Enable the Cloudflare proxy (orange cloud) for automatic HTTPS
3. Set SSL mode to "Full (Strict)" if your origin has a certificate, or "Flexible" otherwise
4. The server sets secure cookies when `NODE_ENV=production`

### Systemd

```bash
# 1. Build the Linux binary
bun install --frozen-lockfile
bun run build:binary --target bun-linux-x64

# 2. Create system user
sudo useradd -r -s /bin/false meta-search

# 3. Install binary and config
sudo install -d -o meta-search -g meta-search /opt/meta-search /opt/meta-search/data
sudo install -m 755 dist-bin/meta-search-linux-x64 /opt/meta-search/meta-search
sudo install -m 640 config.jsonc /opt/meta-search/config.jsonc
sudo chown -R meta-search:meta-search /opt/meta-search

# 4. Install and start service
sudo cp deploy/meta-search.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now meta-search

# 5. Check status
sudo systemctl status meta-search
journalctl -u meta-search -f
```

### Proxy Support

The server reads standard proxy environment variables and routes all outbound requests through the configured proxy:

- `https_proxy` / `HTTPS_PROXY`
- `http_proxy` / `HTTP_PROXY`

## Architecture

```
Request flow:

  Client --POST /mcp--> [PAT Auth] --> MCP Transport --> Tool Handler
                                                                  |
                                                     [Perf Middleware]
                                                      cache / circuit breaker
                                                      single-flight / limiter
                                                                  |
                                                       [Key Pool Rotation]
                                                                  |
                                                       Provider API (Tavily/Exa/...)
                                                                  |
                                                       [Response] --> SQLite Log

Admin flow:

  Browser --/app/*--> Static SPA (WebUI)
  Browser --/api/admin/*--> [Session Auth] --> Admin Router
                                                  |
                                    providers / pats / settings
                                    logs / dashboard / reload
```

### Packages

| Package | Purpose |
|---------|---------|
| `@meta-search/shared` | Zod schemas, utility functions (compactObject, maskKey, etc.) |
| `@meta-search/config` | JSONC parser, config loading, validation, atomic writes |
| `@meta-search/runtime` | KeyPool, key rotation, performance middleware (cache, circuit breaker, single-flight, limiter, metrics) |

### Apps

| App | Purpose |
|-----|---------|
| `apps/server` | HTTP server (Hono), MCP transport, admin API, SQLite database |
| `apps/web` | Admin dashboard static assets |

## Requirements

- Bun >= 1.3
