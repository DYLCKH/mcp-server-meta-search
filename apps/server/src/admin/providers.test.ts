import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "@meta-search/config";
import { buildRuntimeState } from "../runtime-state.js";
import { createProviderRoutes } from "./providers.js";
import type { AdminDeps, AuditLogWriteEntry, DbHandle } from "./types.js";

const tempDirs: string[] = [];

function createConfigPath(config: unknown): string {
  const tempDir = mkdtempSync(join(tmpdir(), "meta-search-providers-"));
  tempDirs.push(tempDir);

  const configPath = join(tempDir, "config.jsonc");
  writeFileSync(configPath, JSON.stringify(config), "utf-8");

  return configPath;
}

function readConfig(configPath: string) {
  return JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, any>;
}

function createDeps(configPath: string): {
  deps: AdminDeps;
  auditLogs: AuditLogWriteEntry[];
} {
  const config = resolveConfig(configPath);
  const auditLogs: AuditLogWriteEntry[] = [];
  const db: DbHandle = {
    queryRequestLogs: () => [],
    queryAuditLogs: () => [],
    insertAuditLog: (entry) => {
      auditLogs.push(entry);
    },
  };

  return {
    deps: {
      configPath,
      runtimeState: {
        current: buildRuntimeState(config, dirname(configPath)),
      },
      patSnapshot: { current: {} as AdminDeps["patSnapshot"]["current"] },
      db,
    },
    auditLogs,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("provider key admin routes", () => {
  it("adds multiple provider API keys in one request", async () => {
    const configPath = createConfigPath({
      tavily: {
        api_keys: ["existing-key"],
      },
    });
    const { deps, auditLogs } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    const response = await app.request("http://localhost/tavily/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_keys: [" new-key-1 ", "new-key-2"],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, added: 2 });
    expect(readConfig(configPath).tavily.api_keys).toEqual([
      "existing-key",
      "new-key-1",
      "new-key-2",
    ]);
    expect(deps.runtimeState.current.tavilyKeyPool.size()).toBe(3);
    expect(auditLogs.at(-1)?.detail).toBe("count=2");
  });

  it("keeps the legacy single provider API key payload working", async () => {
    const configPath = createConfigPath({});
    const { deps } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    const response = await app.request("http://localhost/exa/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: "exa-key",
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, added: 1 });
    expect(readConfig(configPath).exa.api_keys).toEqual(["exa-key"]);
  });

  it("adds multiple Cloudflare account credentials in one request", async () => {
    const configPath = createConfigPath({
      cloudflare: {
        accounts: [
          {
            account_id: "account-existing",
            api_token: "token-existing",
          },
        ],
      },
    });
    const { deps } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    const response = await app.request("http://localhost/cloudflare/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_keys: [
          {
            account_id: " account-one ",
            api_token: " token-one ",
          },
          {
            account_id: "account-two",
            api_token: "token-two",
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, added: 2 });
    expect(readConfig(configPath).cloudflare.accounts).toEqual([
      {
        account_id: "account-existing",
        api_token: "token-existing",
      },
      {
        account_id: "account-one",
        api_token: "token-one",
      },
      {
        account_id: "account-two",
        api_token: "token-two",
      },
    ]);
    expect(deps.runtimeState.current.cloudflareKeyPool.size()).toBe(3);
  });

  it("rejects empty bulk payloads without creating provider config", async () => {
    const configPath = createConfigPath({});
    const { deps } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    const response = await app.request("http://localhost/jina/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_keys: [],
      }),
    });

    expect(response.status).toBe(400);
    expect(readConfig(configPath).jina).toBeUndefined();
  });

  it("checks Tavily usage for a specific API key", async () => {
    const configPath = createConfigPath({
      request_timeout_ms: 1_000,
      tavily: {
        base_url: "https://tavily.example",
        api_keys: ["tvly-test"],
      },
    });
    const { deps, auditLogs } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://tavily.example/usage");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer tvly-test",
        "X-Project-ID": "project-123",
      });

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            key: {
              usage: 8,
              limit: 20,
            },
            account: {
              plan_usage: 80,
              plan_limit: 200,
            },
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request("http://localhost/tavily/keys/0/usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: "project-123",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: "tavily",
      index: 0,
      usage: {
        provider: "tavily_usage",
        project_id: "project-123",
        key: {
          usage: 8,
          limit: 20,
          remaining: 12,
        },
        account: {
          plan_usage: 80,
          plan_limit: 200,
          plan_remaining: 120,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auditLogs.at(-1)).toMatchObject({
      action: "check_usage",
      target_name: "tavily",
      detail: "index=0",
    });
  });

  it("runs upstream health checks for non-Tavily providers", async () => {
    const configPath = createConfigPath({
      request_timeout_ms: 1_000,
      exa: {
        base_url: "https://exa.example",
        api_keys: ["exa-key"],
      },
      perplexity: {
        base_url: "https://perplexity.example",
        api_keys: ["pplx-key"],
      },
      jina: {
        base_url: "https://jina.example",
        api_keys: ["jina-key"],
      },
      cloudflare: {
        base_url: "https://cloudflare.example/client/v4",
        accounts: [
          {
            account_id: "account-id",
            api_token: "cf-token",
          },
        ],
      },
    });
    const { deps, auditLogs } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    const expectedRequests = [
      {
        provider: "exa",
        url: "https://exa.example/search",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "exa-key",
        },
        body: {
          query: "test",
          numResults: 1,
          type: "fast",
        },
        response: { results: [] },
      },
      {
        provider: "perplexity",
        url: "https://perplexity.example/search",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pplx-key",
        },
        body: {
          query: "test",
          max_results: 1,
          max_tokens_per_page: 1,
        },
        response: { results: [] },
      },
      {
        provider: "jina",
        url: "https://jina.example/",
        headers: {
          Accept: "text/plain",
          Authorization: "Bearer jina-key",
        },
        body: {
          url: "https://example.com",
        },
        response: "Example Domain",
      },
      {
        provider: "cloudflare",
        url: "https://cloudflare.example/client/v4/user/tokens/verify",
        headers: {
          Authorization: "Bearer cf-token",
        },
        response: {
          success: true,
          result: {
            status: "active",
          },
        },
      },
    ];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const expected = expectedRequests.shift();
      expect(expected).toBeDefined();
      expect(url).toBe(expected!.url);
      expect(init?.headers).toMatchObject(expected!.headers);
      if ("body" in expected!) {
        expect(JSON.parse(String(init?.body))).toMatchObject(expected!.body);
      }

      return {
        ok: true,
        status: 200,
        text: async () =>
          typeof expected!.response === "string"
            ? expected!.response
            : JSON.stringify(expected!.response),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const provider of ["exa", "perplexity", "jina", "cloudflare"]) {
      const response = await app.request(
        `http://localhost/${provider}/keys/0/check`,
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        provider,
        index: 0,
        ok: true,
        upstream_status: 200,
        health: {
          status: "active",
        },
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(auditLogs.filter((entry) => entry.action === "check_key")).toHaveLength(4);
  });

  it("disables a key when upstream health check returns an auth error", async () => {
    const configPath = createConfigPath({
      request_timeout_ms: 1_000,
      exa: {
        base_url: "https://exa.example",
        api_keys: ["bad-exa-key"],
      },
    });
    const { deps } = createDeps(configPath);
    const app = createProviderRoutes(deps);

    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid api key" }),
    }));

    const response = await app.request("http://localhost/exa/keys/0/check", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      provider: "exa",
      index: 0,
      ok: false,
      upstream_status: 401,
      health: {
        status: "disabled",
      },
      error: "exa: invalid API key. Replace or remove it.",
      details: "invalid api key",
    });
    expect(deps.runtimeState.current.exaKeyPool.getStatus(0).status).toBe(
      "disabled",
    );
  });
});
