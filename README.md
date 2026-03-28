# Web Search MCP Server

An MCP (Model Context Protocol) server providing web search and page fetching tools with automatic API key rotation and key health tracking.

## Tools

| Tool | Provider | Description |
|------|----------|-------------|
| `search_tavily` | [Tavily](https://tavily.com/) | General-purpose web search with AI answer generation |
| `search_exa` | [Exa](https://exa.ai/) | AI-native search with neural, keyword, and hybrid modes |
| `search_perplexity` | [Perplexity](https://www.perplexity.ai/) | Lightweight structured web search |
| `fetch_jina_markdown` | [Jina Reader](https://jina.ai/reader/) | Default lightweight Markdown fetch for most pages |
| `fetch_as_markdown` | [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/) | Browser-rendered Markdown fallback for JS-heavy pages |

## Quick Start

```bash
node web-search.mjs
```

OpenCode configuration:

```jsonc
{
  "mcp": {
    "web-search": {
      "type": "local",
      "command": ["node", "/path/to/web-search.mjs"]
    }
  }
}
```

## Configuration

The server uses **JSONC** (`config.jsonc`) as its primary configuration format, with environment variable overrides.

### Config Resolution Order

1. Load `config.jsonc` (if exists)
2. If `config.jsonc` does not exist but `.env` does → auto-migrate to `config.jsonc`
3. Apply environment variable overrides (double-underscore nesting, e.g. `TAVILY__API_KEYS`)
4. Environment variables always take priority over file values

See [`config.jsonc.example`](config.jsonc.example) for all available fields.

### Environment Variable Overrides

Environment variables map to config fields using double-underscore (`__`) as the nesting separator:

| Env Var | Config Field |
|---------|-------------|
| `TAVILY__API_KEYS` | `tavily.api_keys` |
| `JINA__API_KEYS` | `jina.api_keys` |
| `JINA__BASE_URL` | `jina.base_url` |
| `CLOUDFLARE__ACCOUNTS` | `cloudflare.accounts` |
| `KEY_ROTATION_STRATEGY` | `key_rotation_strategy` |

Values are parsed as JSON when possible (supports arrays and objects), otherwise kept as strings.

### Legacy `.env` Format

The `.env` format is **deprecated**. If `config.jsonc` does not exist, the server will auto-migrate `.env` on first startup. See [`.example`](.example) for the legacy format reference.

## Tool Reference

### `search_tavily`

**Endpoint:** `POST https://api.tavily.com/search`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *(required)* | Search query |
| `max_results` | integer | `5` | Number of results (1–20) |
| `search_depth` | enum | — | `basic` \| `advanced` \| `fast` \| `ultra-fast` |
| `topic` | enum | — | `general` \| `news` \| `finance` |
| `time_range` | enum | — | `day` \| `week` \| `month` \| `year` |
| `include_domains` | string[] | — | Restrict to these domains (max 300) |
| `exclude_domains` | string[] | — | Exclude these domains (max 150) |
| `include_answer` | bool \| string | — | `true` / `"basic"` / `"advanced"` |
| `include_raw_content` | bool \| string | — | `true` / `"markdown"` / `"text"` |
| `include_images` | boolean | — | Include image results |
| `include_image_descriptions` | boolean | — | Add descriptions to images |
| `include_favicon` | boolean | — | Include favicon URL per result |
| `auto_parameters` | boolean | — | Let Tavily auto-configure based on query intent |
| `include_usage` | boolean | — | Include credit usage info |

### `search_exa`

**Endpoint:** `POST https://api.exa.ai/search`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *(required)* | Search query |
| `num_results` | integer | `10` | Number of results (1–100) |
| `type` | enum | — | `neural` \| `fast` \| `auto` \| `deep` \| `instant` |
| `category` | enum | — | `company` \| `research paper` \| `news` \| `tweet` \| `personal site` \| `financial report` \| `people` |
| `user_location` | string | — | Two-letter ISO country code |
| `include_domains` | string[] | — | Restrict to these domains (max 1200) |
| `exclude_domains` | string[] | — | Exclude these domains (max 1200) |
| `start_published_date` | string | — | ISO 8601; only results published after this |
| `end_published_date` | string | — | ISO 8601; only results published before this |
| `start_crawl_date` | string | — | ISO 8601; only results crawled after this |
| `end_crawl_date` | string | — | ISO 8601; only results crawled before this |
| `include_text` | boolean | — | Return full page text |
| `include_highlights` | boolean | — | Return relevant snippets |
| `include_summary` | boolean | — | Return LLM-generated summary per result |
| `summary_query` | string | — | Custom query to direct summary generation |
| `max_age_hours` | integer | — | Max cache age in hours |

### `search_perplexity`

**Endpoint:** `POST https://api.perplexity.ai/search`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *(required)* | Search query |
| `max_results` | integer | `10` | Number of results (1–20) |
| `max_tokens_per_page` | integer | `1024` | Max tokens per result page (256–2048) |
| `country` | string | — | ISO 3166-1 alpha-2 country code |

### `fetch_jina_markdown`

**Endpoint:** `POST https://r.jina.ai/`

Default first-choice Markdown fetch via Jina Reader. Use this first for most public pages. If the content is incomplete or the page requires real browser rendering / JavaScript execution, fall back to `fetch_as_markdown`. Returns the extracted Markdown directly as `content[0].text` with minimal metadata in `structuredContent`.

Fixed request behavior:

- `X-Respond-With: markdown`
- `X-Retain-Images: none`
- `X-Retain-Links: text`
- `X-Cache-Tolerance: 3600` (accept cached responses up to 1 hour old)
- `DNT: 1` (sends a Do Not Track signal)
- `X-Timeout: 30` by default, derived from `request_timeout_ms`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | *(required)* | Absolute `http(s)` URL to fetch |
| `wait_for_selector` | string | — | Wait for this CSS selector before extraction; if it never appears, the upstream request may fail |
| `target_selector` | string | — | Restrict extraction to this CSS selector, useful for isolating the main content area |
| `remove_selector` | string | — | Remove this CSS selector before extraction, such as ads, nav, or banners |

### `fetch_as_markdown`

**Endpoint:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-rendering/markdown`

Cloudflare browser-rendering fallback. Use this after `fetch_jina_markdown` when content is missing, login-gated, or the page needs full browser rendering / JavaScript execution.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | Absolute `http(s)` URL to fetch. Required unless `html` is provided |
| `html` | string | — | Raw HTML to convert (alternative to `url`). Provide either `html` or `url` |
| `cacheTTL` | integer | `5` | Cache TTL in seconds (0–86400, sent as query param) |
| `gotoOptions` | object | — | `{waitUntil, timeout}` — navigation options |
| `waitForSelector` | object | — | `{selector, visible, hidden, timeout}` — wait for element |
| `cookies` | object[] | — | Cookies to set before navigation |
| `authenticate` | object | — | `{username, password}` — HTTP Basic Auth |
| `setExtraHTTPHeaders` | object | — | Custom HTTP headers |
| `viewport` | object | — | `{width, height, deviceScaleFactor}` |
| `userAgent` | string | — | Custom User-Agent |
| `rejectRequestPattern` | string[] | — | URL patterns to block |
| `rejectResourceTypes` | string[] | — | Resource types to block |
| `allowRequestPattern` | string[] | — | URL patterns to allow |
| `allowResourceTypes` | string[] | — | Resource types to allow |
| `addScriptTag` | object[] | — | JS to inject before rendering |
| `addStyleTag` | object[] | — | CSS to inject before rendering |
| `setJavaScriptEnabled` | boolean | `true` | Enable/disable JavaScript |

> **Cloudflare API Token requirement:** The token must have **Account / Browser Rendering / Edit** permission. A "Read" permission will result in 401 errors. Create tokens at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

## Key Rotation & Health Tracking

### Rotation

Each provider supports multiple API keys. Keys are rotated automatically on failure.

- **Strategy:** `round_robin` (default) or `random`
- **Retry triggers:** HTTP 401, 402, 403, 408, 409, 425, 429, 432, 433, 500, 502, 503, 504, network timeouts, and connection errors

### Key Health State Machine

Keys are tracked with a health state:

```
active ──(auth error 401/402/403)──→ disabled ──(recovery timeout)──→ active
                                         │
                                  (disable count ≥ max)
                                         │
                                         ▼
                                      revoked  →  written to invalid-keys.json
```

- **`active`** — key is available for use
- **`disabled`** — temporarily removed after auth error; automatically re-enabled after `key_recovery_interval_ms` (default: 5 minutes)
- **`revoked`** — permanently removed after `max_disable_before_revoke` (default: 3) cumulative failures; recorded to `invalid-keys.json` with masked key values

### Startup Summary

On startup, the server outputs a summary to stderr:

```
[web-search] Starting up...
[web-search]   Tavily: 13 key(s)
[web-search]   Exa: 16 key(s)
[web-search]   Perplexity: 9 key(s)
[web-search]   Jina: anonymous access
[web-search]   Cloudflare: 1 key(s)
[web-search]   Strategy: round_robin | Timeout: 30000ms | Recovery: 300000ms | Max disable: 3
[web-search] Ready.
```

## Proxy Support

The server reads standard proxy environment variables and routes all requests through the proxy using undici's `ProxyAgent`:

- `https_proxy` / `HTTPS_PROXY`
- `http_proxy` / `HTTP_PROXY`

## Configuration Reference

| Field | Env Override | Default | Description |
|-------|-------------|---------|-------------|
| `tavily.api_keys` | `TAVILY__API_KEYS` | — | Tavily API key(s) |
| `tavily.base_url` | `TAVILY__BASE_URL` | `https://api.tavily.com` | Tavily API base URL |
| `exa.api_keys` | `EXA__API_KEYS` | — | Exa API key(s) |
| `exa.base_url` | `EXA__BASE_URL` | `https://api.exa.ai` | Exa API base URL |
| `perplexity.api_keys` | `PERPLEXITY__API_KEYS` | — | Perplexity API key(s) |
| `perplexity.base_url` | `PERPLEXITY__BASE_URL` | `https://api.perplexity.ai` | Perplexity API base URL |
| `jina.api_keys` | `JINA__API_KEYS` | — | Optional Jina Reader API key(s) |
| `jina.base_url` | `JINA__BASE_URL` | `https://r.jina.ai` | Jina Reader base URL |
| `cloudflare.accounts` | `CLOUDFLARE__ACCOUNTS` | — | `[{account_id, api_token}]` pairs |
| `cloudflare.base_url` | `CLOUDFLARE__BASE_URL` | `https://api.cloudflare.com/client/v4` | Cloudflare API base URL |
| `key_rotation_strategy` | `KEY_ROTATION_STRATEGY` | `round_robin` | `round_robin` or `random` |
| `max_attempts_per_request` | `MAX_ATTEMPTS_PER_REQUEST` | `0` | Max retries (`0` = try each key once) |
| `request_timeout_ms` | `REQUEST_TIMEOUT_MS` | `30000` | Request timeout in ms |
| `key_recovery_interval_ms` | `KEY_RECOVERY_INTERVAL_MS` | `300000` | Time before disabled key retries |
| `max_disable_before_revoke` | `MAX_DISABLE_BEFORE_REVOKE` | `3` | Failures before permanent revocation |
| `invalid_keys_file` | `INVALID_KEYS_FILE` | `invalid-keys.json` | File path for revoked keys |

## Requirements

- Node.js (ESM support required)
- Dependencies: `@modelcontextprotocol/sdk`, `zod`, `undici`
