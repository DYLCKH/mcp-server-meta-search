# MCP Search Rotator

An MCP (Model Context Protocol) server providing three search tools — Tavily, Exa, and Perplexity — with automatic API key rotation. Supports multiple API keys per provider and retries with the next key on auth failures, rate limiting, or transient errors.

## Quick Start

```bash
node mcp-search-rotator.mjs
```

**OpenCode configuration example:**

```json
{
  "mcp": {
    "search-rotator": {
      "type": "local",
      "command": ["node", "/path/to/mcp-search-rotator.mjs"]
    }
  }
}
```

## Requirements

- Node.js (ESM support required)
- Dependencies: `@modelcontextprotocol/sdk`, `zod`, `undici`

## Tools

### `search_tavily`

General-purpose web search via [Tavily](https://tavily.com/).

**Endpoint:** `POST https://api.tavily.com/search`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | *(required)* | Search query |
| `max_results` | integer | `5` | Number of results (1–20) |
| `search_depth` | enum | — | `basic`, `advanced`, `fast`, or `ultra-fast` |
| `topic` | enum | — | `general`, `news`, or `finance` |
| `time_range` | enum | — | `day`, `week`, `month`, or `year` |
| `include_domains` | string[] | — | Restrict results to these domains |
| `exclude_domains` | string[] | — | Exclude results from these domains |
| `include_answer` | boolean \| string | — | `true`/`"basic"` for quick answer, `"advanced"` for detailed |
| `include_raw_content` | boolean \| string | — | `true`/`"markdown"` for markdown, `"text"` for plain text |
| `include_images` | boolean | — | Include image search results |
| `include_image_descriptions` | boolean | — | Add descriptions to images (requires `include_images`) |
| `include_favicon` | boolean | — | Include favicon URL per result |
| `auto_parameters` | boolean | — | Let Tavily auto-configure parameters based on query intent |
| `include_usage` | boolean | — | Include credit usage info in response |

### `search_exa`

AI-native search via [Exa](https://exa.ai/) with neural, keyword, and hybrid modes.

**Endpoint:** `POST https://api.exa.ai/search`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | *(required)* | Search query |
| `num_results` | integer | `10` | Number of results (1–100) |
| `type` | enum | — | `neural`, `fast`, `auto`, `deep`, or `instant` |
| `category` | enum | — | `company`, `research paper`, `news`, `tweet`, `personal site`, `financial report`, or `people` |
| `user_location` | string | — | Two-letter ISO country code |
| `include_domains` | string[] | — | Restrict results to these domains |
| `exclude_domains` | string[] | — | Exclude results from these domains |
| `start_crawl_date` | string | — | ISO 8601 date; only results crawled after this |
| `end_crawl_date` | string | — | ISO 8601 date; only results crawled before this |
| `start_published_date` | string | — | ISO 8601 date; only results published after this |
| `end_published_date` | string | — | ISO 8601 date; only results published before this |
| `include_text` | boolean | — | Return full page text content |
| `include_highlights` | boolean | — | Return relevant text snippets |
| `include_summary` | boolean | — | Return LLM-generated summary per result |
| `summary_query` | string | — | Custom query to direct summary generation |
| `max_age_hours` | integer | — | Max cache age in hours (`0` = always livecrawl, `-1` = always cache) |

### `search_perplexity`

Lightweight structured web search via [Perplexity](https://www.perplexity.ai/) (uses the search endpoint, not chat/completions).

**Endpoint:** `POST https://api.perplexity.ai/search`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | *(required)* | Search query |
| `max_results` | integer | `10` | Number of results (1–20) |
| `max_tokens_per_page` | integer | `1024` | Max tokens of content per result page (256–2048) |
| `country` | string | — | ISO 3166-1 alpha-2 country code to bias results |

## API Key Rotation

Supply one or more API keys per provider via environment variables:

| Provider | Single Key | Multiple Keys (comma-separated) |
|---|---|---|
| Tavily | `TAVILY_API_KEY` | `TAVILY_API_KEYS` |
| Exa | `EXA_API_KEY` | `EXA_API_KEYS` |
| Perplexity | `PERPLEXITY_API_KEY` | `PERPLEXITY_API_KEYS` |

**Rotation behavior:**

- **Strategy:** Round-robin by default. Set `SEARCH_KEY_ROTATION_STRATEGY=random` for random selection.
- **Retry triggers:** HTTP 401, 402, 403, 408, 409, 425, 429, 432, 433, 500, 502, 503, 504, and network timeouts.
- **Attempt limit:** `SEARCH_MAX_ATTEMPTS_PER_REQUEST` — `0` (default) tries each key once; a positive value caps the total attempts.

## Proxy Support

The server reads standard proxy environment variables and routes all requests through the proxy using undici's `ProxyAgent`:

- `https_proxy` / `HTTPS_PROXY`
- `http_proxy` / `HTTP_PROXY`

This is useful when certain API endpoints (e.g., Perplexity on Meta infrastructure) are not directly reachable.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TAVILY_API_KEY` / `TAVILY_API_KEYS` | — | Tavily API key(s) |
| `EXA_API_KEY` / `EXA_API_KEYS` | — | Exa API key(s) |
| `PERPLEXITY_API_KEY` / `PERPLEXITY_API_KEYS` | — | Perplexity API key(s) |
| `SEARCH_KEY_ROTATION_STRATEGY` | `round_robin` | Key rotation strategy (`round_robin` or `random`) |
| `SEARCH_MAX_ATTEMPTS_PER_REQUEST` | `0` | Max retry attempts per request (`0` = try all keys once) |
| `SEARCH_REQUEST_TIMEOUT_MS` | `30000` | Request timeout in milliseconds |
| `TAVILY_BASE_URL` | `https://api.tavily.com` | Override Tavily API base URL |
| `EXA_BASE_URL` | `https://api.exa.ai` | Override Exa API base URL |
| `PERPLEXITY_BASE_URL` | `https://api.perplexity.ai` | Override Perplexity API base URL |

Configuration is loaded from a `.env` file in the same directory as the script, or from system environment variables. `.env` values do **not** override existing environment variables.
