# Remote MCP Server, Admin WebUI, and Performance Upgrade Design

## Overview

This document defines the v1 redesign of the current local `stdio` MCP server into a server-hosted product that clients connect to remotely. The new system remains a single deployable service, but it is organized internally into clear modules so it can evolve without a rewrite.

The target outcome is:

- a server-hosted MCP endpoint using Streamable HTTP
- a single-tenant Admin WebUI for managing provider keys, PATs, and runtime settings
- better runtime performance through in-memory snapshots, connection reuse, concurrency control, and async logging
- operational simplicity for single-machine binary deployment or Docker deployment

## Goals

- Replace local `stdio` transport with remote `Streamable HTTP` transport.
- Let MCP clients connect directly to the server instead of starting a local process.
- Add a single-tenant WebUI for provider key, Cloudflare account, PAT, and runtime setting management.
- Keep configuration in JSON/JSONC so migration, backup, and machine-to-machine movement stay simple.
- Store logs and audit history in a local database without putting the database on the hot request path.
- Preserve the current tool set and provider behavior as much as possible during the transport upgrade.
- Build for low-latency single-node operation first, while leaving clean seams for a later split between control plane and runtime.

## Non-Goals

- No multi-tenant workspace or organization model.
- No billing, quota accounting, or per-user metering in v1.
- No Kubernetes-first architecture.
- No SSE compatibility in v1; Streamable HTTP is the only remote MCP protocol.
- No distributed config store or multi-node config synchronization in v1.

## Confirmed Product Decisions

- Deployment shape: single-process application, packaged as either a single-machine binary or Docker image.
- MCP protocol: Streamable HTTP.
- Client auth: PAT token.
- Admin scope: single-tenant management console.
- HTTPS termination: handled by CDN or reverse proxy, not inside the application.
- Config source of truth: JSON/JSONC file.
- Database scope: logs, audit history, and optional aggregated metrics only.
- PAT visibility: PATs may be viewed multiple times from the WebUI.

## High-Level Architecture

The new application is a modular monolith. One process serves the MCP endpoint, Admin API, and WebUI, but the code is separated into runtime, control-plane, config, and shared layers.

```text
CDN / Reverse Proxy
        |
        v
+------------------------------+
|          App Process         |
|                              |
|  /mcp        -> MCP runtime  |
|  /api/admin  -> Admin API    |
|  /app        -> WebUI        |
|                              |
|  In-memory snapshots         |
|  Provider engine             |
|  Config service              |
|  Async log pipeline          |
+------------------------------+
        |                  |
        |                  +--> logs.db
        |
        +--> config.jsonc
```

The application is split into these internal modules:

- `mcp-runtime`: remote MCP transport, tool registration, request lifecycle, auth handoff
- `provider-engine`: provider adapters, key rotation, health tracking, retries, cache, concurrency limits, circuit breaking
- `control-plane`: Admin API, config mutation, audit logging, hot reload orchestration
- `admin-web`: single-tenant WebUI
- `config-service`: JSONC schema validation, atomic writes, backup creation, runtime snapshot rebuilds
- `shared`: types, utilities, common response models, logging helpers

This keeps v1 operationally simple while allowing a later split into separate runtime and control-plane processes if needed.

## HTTP Surface

The application exposes these primary surfaces:

- `POST /mcp` and related Streamable HTTP MCP routes: remote MCP entrypoint for machine clients
- `/api/admin/*`: Admin API for WebUI actions
- `/app/*`: static WebUI assets and client-side routes
- `/healthz`: process health check
- `/readyz`: readiness check after config load and runtime initialization
- `/metrics`: optional Prometheus-style metrics endpoint for runtime visibility

The MCP surface and Admin surface use separate middleware stacks, auth strategies, and error formatting. Machine clients should never need browser session state, and browsers should never use PATs to drive admin actions.

## Configuration and Storage Model

### Configuration Source of Truth

All runtime configuration remains in `config.jsonc`. This includes:

- provider credentials and account definitions
- PAT definitions
- admin auth settings
- timeout, retry, rotation, cache, concurrency, and rate-limit settings
- feature flags and operational toggles

The app loads the config file on startup, validates it against a schema, and builds immutable in-memory snapshots used by request handlers.

### Log Database

The local database exists only for operational history. It stores:

- MCP request logs
- admin audit logs
- optional rollup tables for latency, error rate, and cache hit summaries

The database does not store provider keys, Cloudflare accounts, PAT definitions, or runtime settings. That keeps migration and backup centered around the config file while still giving the operator durable history.

For v1, the default log database is a local SQLite file in WAL mode, for example `logs.db`. This matches the single-node deployment target and keeps setup simple.

### Secret Representation in Config

Because PATs must be viewable multiple times in the WebUI, the system needs retrievable secret storage. To balance retrievability with basic at-rest protection, the config format supports secret objects with both lookup metadata and encrypted values.

Example design pattern:

```json
{
  "pats": [
    {
      "name": "default-client",
      "prefix": "pat_abcd",
      "hash": "...",
      "encrypted": "...",
      "expires_at": null,
      "disabled": false
    }
  ]
}
```

The same pattern applies to provider secrets when managed from the WebUI. Runtime verification uses hash and in-memory indexes. Secret display in the WebUI uses server-side decryption. The encryption key is supplied through environment configuration, for example `APP_MASTER_KEY`, and must travel with the config file during migration.

For compatibility with the current repository, the loader may accept legacy plaintext secrets at import time, but all WebUI saves rewrite them into the structured encrypted form.

If the config contains encrypted secret records and the application starts without the configured master key, readiness fails and admin secret operations remain unavailable until the key is restored. The service should not silently fall back to unreadable or partial secret state.

### Config Update Workflow

The Admin API never edits the live config file in place. Updates follow this sequence:

1. Load current config into memory.
2. Apply the requested mutation.
3. Validate the whole document against the config schema.
4. Write a timestamped backup copy.
5. Write a temporary file.
6. Atomically replace the active config file.
7. Rebuild runtime snapshots.
8. Publish a reload event internally.
9. Write an audit log entry.

If any step fails before the atomic replace, the running service keeps the previous config and snapshots.

## Authentication and Security Model

### MCP Client Auth

Remote MCP clients authenticate with `Authorization: Bearer <PAT>`. Each PAT record includes:

- name
- optional note
- token prefix
- token hash
- encrypted token value
- disabled flag
- optional expiration timestamp
- created timestamp
- last-used timestamp

The runtime validates PATs using in-memory hashed indexes. The full token value is not needed on the hot path.

PATs may be viewed multiple times in the WebUI. Each reveal action writes an audit log entry containing who revealed the token, which token was revealed, and when it happened.

### Admin Auth

Admin WebUI auth is separate from MCP auth. The admin user model is single-tenant and local. The browser logs in through a session-based flow using a secure, `httpOnly` cookie.

Because v1 is single-node, server-side session storage may be kept in memory. Admin credential configuration lives in `config.jsonc` as password hashes or is bootstrapped by environment variables and then persisted into the config file through an explicit initialization flow.

### Proxy and CDN Awareness

The application does not terminate TLS itself. It assumes TLS is terminated by a trusted CDN or reverse proxy. The app must therefore:

- trust forwarded headers only from approved proxy ranges
- derive scheme and client IP safely from forwarded headers
- support origin and CORS rules for approved client surfaces
- generate absolute URLs using forwarded host and scheme when needed

## MCP Request Flow

The runtime request path is optimized around immutable in-memory snapshots.

1. Request enters the Streamable HTTP MCP endpoint.
2. Auth middleware validates the bearer PAT from the auth snapshot.
3. Tool routing resolves the requested MCP tool.
4. Provider engine loads provider settings and health state from the provider snapshot.
5. Cache layer checks for eligible hits.
6. Concurrency limiter admits or rejects the upstream call.
7. Provider adapter selects a key or account.
8. Upstream request executes with retries, key rotation, and circuit-breaker checks.
9. Result is normalized into MCP tool output.
10. Async pipeline records request log and metrics.
11. Response returns to the client.

The request path does not read `config.jsonc` or the log database synchronously after startup or reload. This keeps latency stable under load.

## Admin Workflow and Hot Reload

The WebUI focuses on operational tasks needed to run the service daily.

### Dashboard

- process status and version
- provider health counts by active, disabled, and revoked
- request rate, error rate, and latency summaries
- cache hit rate and recent failures

### Provider Keys

- add, edit, disable, delete, and inspect provider credentials
- group credentials by provider
- show health state and last error context
- support manual health check and manual recovery for disabled credentials

### PAT Management

- create, view, copy, disable, and delete PATs
- show created time, last used time, expiration, and status
- allow repeated full-token reveal with audit logging

### Runtime Settings

- manage timeout, retry, rotation, recovery, cache, concurrency, and rate-limit settings
- indicate whether a change is immediately hot-reloadable or applied only to new requests

### Audit and Request Logs

- filter by token, tool, provider, status, time range, and operation type
- inspect why a request failed or why a credential was disabled or revoked

Hot reload behavior is split into two classes:

- immediate reload: PATs, provider credentials, retry settings, timeout settings, cache TTLs, concurrency limits, rate limits
- gradual rollover: low-level connection pool options that can apply to new requests without disrupting in-flight work

If snapshot rebuild fails after a config write, the application keeps the previous active snapshots and surfaces the reload failure in the admin UI and logs.

## Provider Engine Design

The provider engine preserves the current provider coverage and key-rotation behavior, but reorganizes it behind reusable interfaces.

The engine is responsible for:

- provider-specific request shaping and response normalization
- key and account rotation
- key disable and revoke rules
- temporary recovery windows
- retry classification
- caching
- concurrency control
- circuit breaking
- metrics emission

Each provider adapter implements a consistent contract so MCP tools stay thin. The current tools remain:

- `search_tavily`
- `search_exa`
- `search_perplexity`
- `fetch_jina_markdown`
- `fetch_as_markdown`

The v1 product does not add a new unified meta-router tool. Tool-to-provider mapping stays explicit so behavior remains predictable during the transport migration.

## Performance Strategy

Performance work is prioritized for high ROI on a single-node deployment.

### P1: Immediate Gains

- immutable in-memory auth, provider, and settings snapshots
- shared HTTP clients with keep-alive and connection pooling per provider
- async log writes so MCP responses are not blocked by database I/O
- provider-level concurrency limits and request backpressure

### P2: Strong Runtime Improvements

- in-process result cache with configurable TTL by tool or provider
- single-flight deduplication for identical concurrent requests
- provider-level circuit breakers for repeated timeout or rate-limit failures
- optional persistent cache table for selected workloads if needed later

### P3: Future Extension Points

- split runtime and control plane into separate processes
- external cache or queue if the deployment outgrows a single node
- multi-instance deployment with shared config propagation

The default request optimization order is:

1. validate auth from memory
2. check cache
3. enforce concurrency limits
4. reuse existing HTTP connections
5. record logs asynchronously

## Error Handling

The service uses different error detail levels for machine clients and operators.

- MCP client responses stay concise and actionable.
- Admin logs preserve more provider detail, retry traces, and health-state transitions.
- Config write failures never invalidate the active runtime.
- Snapshot rebuild failures never replace a known-good snapshot.
- A single provider failure only degrades tools mapped to that provider.
- A single key failure only affects that credential; other eligible credentials continue serving traffic.

Startup behavior:

1. load config file
2. validate schema
3. initialize snapshots
4. initialize log database
5. initialize HTTP clients, caches, and limiters
6. begin accepting traffic

Shutdown behavior:

1. stop accepting new requests
2. drain in-flight requests
3. flush async logs
4. close database and network resources

## Observability

The redesign includes operational visibility from day one. Minimum metrics include:

- requests per second
- p50, p95, p99 latency
- provider success and failure rates
- provider 429 and 5xx counts
- cache hit rate
- concurrency limiter rejections
- key disable and revoke counts
- config reload success and failure counts

These metrics back both the dashboard and machine-readable monitoring.

## Proposed Repository Structure

```text
apps/
  server/
  web/
packages/
  runtime/
  config/
  shared/
docs/
  superpowers/
    specs/
```

Suggested responsibilities:

- `apps/server`: MCP routes, Admin API, session handling, reload orchestration, log persistence wiring
- `apps/web`: admin frontend routes, pages, and API client layer
- `packages/runtime`: provider engine, tool definitions, caches, limiters, health logic
- `packages/config`: JSONC schema, encryption helpers, file IO, backups, reload logic
- `packages/shared`: shared types and utility helpers

## Migration Path From the Current Repository

The current repository centers on a single `web-search.mjs` script. Migration happens in controlled steps.

1. Extract provider logic and shared request behavior from `web-search.mjs` into reusable runtime modules.
2. Add a remote server entrypoint that exposes Streamable HTTP instead of `stdio`.
3. Keep the current tools and response shapes stable while transport changes.
4. Introduce `config.jsonc` schema upgrades for encrypted secret records and PAT definitions.
5. Add the log database for request and audit history.
6. Layer in Admin API and WebUI.
7. Add performance features without changing tool semantics.

This sequence keeps the transport migration and admin features incremental rather than rewriting everything at once.

## Testing Strategy

Testing is split into four layers.

### Unit Tests

- config schema validation
- atomic write and backup behavior
- PAT hashing and reveal flow
- provider key rotation and health transitions
- cache key generation and TTL behavior
- concurrency limiter and circuit-breaker behavior

### Integration Tests

- MCP route to provider engine path
- Admin mutation to config write to snapshot reload path
- request log and audit log persistence
- auth split between PAT and admin session flows

### End-to-End Tests

- remote MCP client connects to the running server and calls tools successfully
- WebUI edits a provider key or PAT and new requests observe the change without restart
- reload failure leaves the previous runtime intact

### Operational Verification

- binary deployment smoke test
- Docker deployment smoke test
- reverse-proxy and forwarded-header validation
- backup and restore of `config.jsonc`

## Delivery Plan

### Phase 1: Remote MCP Runtime

- replace local `stdio` transport with Streamable HTTP
- preserve the five existing tools
- add PAT auth and baseline request logging

### Phase 2: Admin API and WebUI

- add single-tenant admin login
- add provider key, PAT, runtime settings, and log pages
- add config write, backup, and hot reload flow

### Phase 3: Performance Enhancements

- add shared HTTP clients, async logging, concurrency limits
- add in-memory caching, single-flight, and circuit breakers
- surface runtime metrics in dashboard and metrics endpoint

### Phase 4: Deployment and Operations

- add Docker packaging and single-machine deployment docs
- add CDN or reverse-proxy deployment examples
- add config import, export, and restore workflows

## Design Summary

The approved v1 direction is a modular monolith that serves remote MCP traffic and a single-tenant management console from one deployable application. Configuration remains JSON/JSONC-based for portability, while durable history goes into a local log database. Runtime performance comes from in-memory snapshots and reusable network primitives, not from shifting the hot path into the database.

This design meets the product goal of moving from a local developer tool to a server-hosted MCP service without prematurely committing to a distributed architecture.
