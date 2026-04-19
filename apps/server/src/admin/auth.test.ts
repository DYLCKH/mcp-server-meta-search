import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRoutes, requireAdminAuth } from "./auth.js";
import type { AdminDeps, DbHandle } from "./types.js";

const SESSION_SECRET = "12345678901234567890123456789012";
const PASSWORD = "correct-horse-battery-staple";
const PASSWORD_HASH = createHash("sha256").update(PASSWORD).digest("hex");

const TEST_DB: DbHandle = {
  queryRequestLogs: () => [],
  queryAuditLogs: () => [],
  insertAuditLog: () => undefined,
};

const tempDirs: string[] = [];

function createConfigPath(sessionTtlMs = 86_400_000): string {
  const tempDir = mkdtempSync(join(tmpdir(), "meta-search-auth-"));
  tempDirs.push(tempDir);

  const configPath = join(tempDir, "config.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      admin: {
        password_hash: PASSWORD_HASH,
        session_secret: SESSION_SECRET,
        session_ttl_ms: sessionTtlMs,
      },
    }),
    "utf-8",
  );

  return configPath;
}

function createDeps(configPath: string, sessionTtlMs = 86_400_000): AdminDeps {
  return {
    configPath,
    runtimeState: {
      current: {
        config: {
          admin: {
            password_hash: PASSWORD_HASH,
            session_secret: SESSION_SECRET,
            session_ttl_ms: sessionTtlMs,
          },
        },
      } as AdminDeps["runtimeState"]["current"],
    },
    patSnapshot: { current: {} as AdminDeps["patSnapshot"]["current"] },
    db: TEST_DB,
  };
}

function createProtectedApp(deps: AdminDeps): Hono {
  const app = new Hono();

  app.route("/auth", createAuthRoutes(deps));
  app.use("/protected", requireAdminAuth(deps));
  app.get("/protected", (c) => c.json({ ok: true }));

  return app;
}

async function loginAndGetCookie(app: Hono): Promise<string> {
  const response = await app.request("http://localhost/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: PASSWORD }),
  });

  expect(response.status).toBe(200);

  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();

  return setCookie!.split(";", 1)[0]!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("admin auth sessions", () => {
  it("accepts a valid session cookie on a fresh router instance", async () => {
    const configPath = createConfigPath();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const cookie = await loginAndGetCookie(createProtectedApp(createDeps(configPath)));
    const response = await createProtectedApp(createDeps(configPath)).request(
      "http://localhost/protected",
      {
        headers: {
          Cookie: cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects cookies after the configured TTL elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T02:17:00.000Z"));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const app = createProtectedApp(createDeps(createConfigPath(1_000), 1_000));
    const cookie = await loginAndGetCookie(app);

    vi.setSystemTime(new Date("2026-04-19T02:17:02.000Z"));
    const response = await app.request("http://localhost/protected", {
      headers: {
        Cookie: cookie,
      },
    });

    expect(response.status).toBe(401);
  });

  it("refreshes the cookie timestamp on authenticated requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T02:17:00.000Z"));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const app = createProtectedApp(createDeps(createConfigPath(1_000), 1_000));
    const initialCookie = await loginAndGetCookie(app);

    vi.setSystemTime(new Date("2026-04-19T02:17:00.500Z"));
    const refreshedResponse = await app.request("http://localhost/protected", {
      headers: {
        Cookie: initialCookie,
      },
    });

    expect(refreshedResponse.status).toBe(200);
    const refreshedCookie = refreshedResponse.headers.get("set-cookie");
    expect(refreshedCookie).toBeTruthy();

    vi.setSystemTime(new Date("2026-04-19T02:17:01.300Z"));
    const response = await app.request("http://localhost/protected", {
      headers: {
        Cookie: refreshedCookie!.split(";", 1)[0]!,
      },
    });

    expect(response.status).toBe(200);
  });
});
