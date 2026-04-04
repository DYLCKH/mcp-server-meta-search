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
  return deps.runtimeState.current.config.admin?.session_ttl_ms ?? 86_400_000;
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

  app.post("/login", async (c) => {
    const body = await c.req.json<{ password?: string }>();
    if (!body?.password) {
      return c.json({ error: "Password required" }, 400);
    }

    const storedHash = getPasswordHash(deps);
    if (!storedHash) {
      return c.json({ error: "Admin not configured" }, 403);
    }

    const inputHash = hashPassword(body.password);
    try {
      if (!timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash))) {
        return c.json({ error: "Invalid password" }, 401);
      }
    } catch {
      return c.json({ error: "Invalid password" }, 401);
    }

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
