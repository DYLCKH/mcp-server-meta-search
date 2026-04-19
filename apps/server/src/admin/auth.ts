import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { mutateConfig } from "@meta-search/config";
import type { AdminDeps } from "./types.js";
import { hashPassword, isLegacySha256Hash, verifyPassword } from "./password.js";

// ---------------------------------------------------------------------------
// Signed session cookie
// ---------------------------------------------------------------------------

interface Session {
  issuedAt: number;
  nonce: string;
}

const DEFAULT_SESSION_TTL_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Login rate limiting (per remote address)
// ---------------------------------------------------------------------------

interface LoginAttemptRecord {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES_PER_WINDOW = 10;
const LOGIN_LOCKOUT_MS = 5 * 60_000;

const loginAttempts = new Map<string, LoginAttemptRecord>();

function getClientKey(c: Context): string {
  const xf = c.req.header("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  return "anonymous";
}

function isLoginLocked(key: string): number | null {
  const record = loginAttempts.get(key);
  if (!record) return null;
  if (record.lockedUntil > Date.now()) return record.lockedUntil;
  return null;
}

function registerLoginFailure(key: string): void {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || now - record.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, {
      failures: 1,
      windowStart: now,
      lockedUntil: 0,
    });
    return;
  }
  record.failures += 1;
  if (record.failures >= LOGIN_MAX_FAILURES_PER_WINDOW) {
    record.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
}

function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

function getSessionSecret(deps: AdminDeps): string {
  const { config } = deps.runtimeState.current;
  const secret = config.admin?.session_secret;
  if (!secret) {
    throw new Error(
      "Admin session secret not configured. Set admin.session_secret in config.jsonc.",
    );
  }
  return secret;
}

function generateSessionNonce(): string {
  return randomBytes(16).toString("hex");
}

function serializeSession(session: Session): string {
  return `${session.issuedAt}.${session.nonce}`;
}

function parseSession(token: string): Session | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;

  const issuedAt = Number.parseInt(token.slice(0, dotIndex), 10);
  const nonce = token.slice(dotIndex + 1);

  if (!Number.isFinite(issuedAt) || issuedAt <= 0 || nonce.length === 0) {
    return null;
  }

  return { issuedAt, nonce };
}

function signToken(token: string, secret: string): string {
  const sig = createHmac("sha256", secret)
    .update(token)
    .digest("hex");
  return `${token}.${sig}`;
}

function verifySignedToken(signed: string, secret: string): Session | null {
  const dotIndex = signed.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const token = signed.slice(0, dotIndex);
  const sig = signed.slice(dotIndex + 1);
  const expected = createHmac("sha256", secret)
    .update(token)
    .digest("hex");
  try {
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return parseSession(token);
    }
  } catch {
    // length mismatch
  }
  return null;
}

function setSessionCookie(c: Context, deps: AdminDeps, session: Session): void {
  const secret = getSessionSecret(deps);
  const signed = signToken(serializeSession(session), secret);

  setCookie(c, "admin_session", signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: "/api/admin",
    maxAge: Math.floor(getSessionTtlMs(deps) / 1000),
  });
}

function clearSessionCookie(c: Context): void {
  deleteCookie(c, "admin_session", { path: "/api/admin" });
}

/**
 * Rehash a legacy SHA-256 password with argon2id and persist to disk. Also
 * patches the in-memory runtime snapshot so subsequent logins use argon2id.
 * Errors are swallowed: login has already succeeded, and the migration will
 * retry on the next successful login.
 */
async function upgradeLegacyPassword(
  deps: AdminDeps,
  plaintext: string,
  priorHash: string,
): Promise<void> {
  try {
    const newHash = await hashPassword(plaintext);
    await mutateConfig(deps.configPath, (config) => {
      if (config.admin?.password_hash === priorHash) {
        config.admin.password_hash = newHash;
        delete (config.admin as { password?: string }).password;
      }
    });
    if (deps.runtimeState.current.config.admin?.password_hash === priorHash) {
      deps.runtimeState.current.config.admin.password_hash = newHash;
    }
    process.stderr.write(
      "[meta-search] Upgraded admin password hash from legacy SHA-256 to argon2id.\n",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[meta-search] Password hash upgrade failed (will retry next login): ${msg}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Password bootstrap
// ---------------------------------------------------------------------------

function getPasswordHash(deps: AdminDeps): string | undefined {
  const { config } = deps.runtimeState.current;
  return config.admin?.password_hash;
}

// ---------------------------------------------------------------------------
// Session TTL
// ---------------------------------------------------------------------------

function getSessionTtlMs(deps: AdminDeps): number {
  return (
    deps.runtimeState.current.config.admin?.session_ttl_ms ?? DEFAULT_SESSION_TTL_MS
  );
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

export function requireAdminAuth(deps: AdminDeps) {
  return async (c: Context, next: () => Promise<void>) => {
    const secret = getSessionSecret(deps);
    const signedCookie = getCookie(c, "admin_session");

    if (!signedCookie) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const session = verifySignedToken(signedCookie, secret);
    if (!session) {
      clearSessionCookie(c);
      return c.json({ error: "Unauthorized" }, 401);
    }

    const ttl = getSessionTtlMs(deps);
    const now = Date.now();
    if (now - session.issuedAt > ttl) {
      clearSessionCookie(c);
      return c.json({ error: "Session expired" }, 401);
    }

    await next();
    setSessionCookie(c, deps, { issuedAt: now, nonce: session.nonce });
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createAuthRoutes(deps: AdminDeps): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const clientKey = getClientKey(c);
    const lockedUntil = isLoginLocked(clientKey);
    if (lockedUntil) {
      const retryAfter = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }

    const body = await c.req.json<{ password?: string }>();
    if (!body?.password) {
      return c.json({ error: "Password required" }, 400);
    }

    const storedHash = getPasswordHash(deps);
    if (!storedHash) {
      return c.json({ error: "Admin not configured" }, 403);
    }

    const matched = await verifyPassword(body.password, storedHash);

    if (!matched) {
      registerLoginFailure(clientKey);
      return c.json({ error: "Invalid password" }, 401);
    }

    clearLoginFailures(clientKey);

    // Upgrade legacy SHA-256 hashes in the background — don't block the response.
    if (isLegacySha256Hash(storedHash)) {
      void upgradeLegacyPassword(deps, body.password, storedHash);
    }

    setSessionCookie(c, deps, {
      issuedAt: Date.now(),
      nonce: generateSessionNonce(),
    });

    return c.json({ ok: true });
  });

  app.post("/logout", async (c) => {
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  return app;
}
