import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AdminDeps } from "./types.js";

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

interface Session {
  createdAt: number;
}

const sessions = new Map<string, Session>();

// Periodically drop sessions that have exceeded the configured TTL so the Map
// doesn't grow unbounded when users log in and never return.
const SESSION_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_SESSION_TTL_MS = 86_400_000;
let sessionCleanupStarted = false;

function startSessionCleanup(deps: AdminDeps): void {
  if (sessionCleanupStarted) return;
  sessionCleanupStarted = true;

  const timer = setInterval(() => {
    const ttl = getSessionTtlMs(deps);
    const threshold = Date.now() - ttl;
    for (const [token, session] of sessions) {
      if (session.createdAt < threshold) {
        sessions.delete(token);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  timer.unref?.();
}

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

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
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

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function signToken(token: string, secret: string): string {
  const sig = createHash("sha256")
    .update(token + secret)
    .digest("hex");
  return `${token}.${sig}`;
}

function verifySignedToken(signed: string, secret: string): string | null {
  const dotIndex = signed.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const token = signed.slice(0, dotIndex);
  const sig = signed.slice(dotIndex + 1);
  const expected = createHash("sha256")
    .update(token + secret)
    .digest("hex");
  try {
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return token;
    }
  } catch {
    // length mismatch
  }
  return null;
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

    const token = verifySignedToken(signedCookie, secret);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const session = sessions.get(token);
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const ttl = getSessionTtlMs(deps);
    if (Date.now() - session.createdAt > ttl) {
      sessions.delete(token);
      return c.json({ error: "Session expired" }, 401);
    }

    // Refresh session timestamp
    session.createdAt = Date.now();

    await next();
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createAuthRoutes(deps: AdminDeps): Hono {
  const app = new Hono();
  startSessionCleanup(deps);

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

    const inputHash = hashPassword(body.password);
    let matched = false;
    try {
      matched = timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
    } catch {
      matched = false;
    }

    if (!matched) {
      registerLoginFailure(clientKey);
      return c.json({ error: "Invalid password" }, 401);
    }

    clearLoginFailures(clientKey);

    // Create session
    const token = generateSessionToken();
    sessions.set(token, { createdAt: Date.now() });

    const secret = getSessionSecret(deps);
    const signed = signToken(token, secret);

    setCookie(c, "admin_session", signed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/api/admin",
      maxAge: Math.floor(getSessionTtlMs(deps) / 1000),
    });

    return c.json({ ok: true });
  });

  app.post("/logout", async (c) => {
    const secret = getSessionSecret(deps);
    const signedCookie = getCookie(c, "admin_session");
    if (signedCookie) {
      const token = verifySignedToken(signedCookie, secret);
      if (token) {
        sessions.delete(token);
      }
    }

    deleteCookie(c, "admin_session", { path: "/api/admin" });
    return c.json({ ok: true });
  });

  return app;
}
