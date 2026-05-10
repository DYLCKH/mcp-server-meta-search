# Upstream Provider Docs

Last reviewed: 2026-04-19

These are the official upstream documentation links used to align provider
schemas and response normalization in this repository. Check these first
before changing MCP tool parameters or upstream payload handling.

## Search Providers

- Tavily Search API:
  [https://docs.tavily.com/documentation/api-reference/endpoint/search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
  Relevant note: `response_time` may be returned as a string, so the
  normalization layer should not assume a numeric-only value.

- Tavily Crawl API:
  [https://docs.tavily.com/documentation/api-reference/endpoint/crawl](https://docs.tavily.com/documentation/api-reference/endpoint/crawl)
  Relevant notes: crawl supports path/domain filters, `max_depth` up to 5,
  `max_breadth` up to 500, `timeout` up to 150 seconds, and uses the same
  Tavily API key pool as search.

- Exa Search API:
  [https://docs.exa.ai/reference/search](https://docs.exa.ai/reference/search)
  Relevant notes:
  `type` currently includes `neural`, `fast`, `auto`, `deep-lite`, `deep`,
  `deep-reasoning`, and `instant`.
  `category` currently includes `company`, `research paper`, `news`,
  `personal site`, `financial report`, and `people`.

- Perplexity Search API:
  [https://docs.perplexity.ai/api-reference/search-post](https://docs.perplexity.ai/api-reference/search-post)
  Relevant note: `max_tokens_per_page` defaults to `4096` and currently
  supports values up to `1000000`.

## Fetch Providers

- Jina Reader:
  [https://jina.ai/reader/](https://jina.ai/reader/)
  Relevant note: the public Reader page is the primary official reference.
  Jina's public docs are lighter on per-header parameter details than the
  other providers, so review current upstream behavior carefully before
  changing header-based controls such as selector overrides.

- Cloudflare Browser Rendering Markdown API:
  [https://developers.cloudflare.com/api/resources/browser_rendering/subresources/markdown/methods/create/](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/markdown/methods/create/)
  Relevant note: `waitForSelector.timeout` currently supports values up to
  `120000` ms.
