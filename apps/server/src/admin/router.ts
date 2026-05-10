import { Hono } from "hono";
import type { AdminDeps } from "./types.js";
import { createAuthRoutes, requireAdminAuth } from "./auth.js";
import { createProviderRoutes } from "./providers.js";
import { createPatRoutes } from "./pats.js";
import { createSettingsRoutes } from "./settings.js";
import { createLogRoutes } from "./logs.js";
import { createReloadRoutes } from "./reload.js";
import { createDashboardRoutes } from "./dashboard.js";
import { createOtaRoutes } from "./ota.js";

/**
 * Create the admin API router. All routes are mounted under the returned
 * Hono instance; the caller should mount it at `/api/admin`.
 */
export function createAdminRouter(deps: AdminDeps): Hono {
  const app = new Hono();

  // Auth routes — no auth required for login, logout is also public
  const authRoutes = createAuthRoutes(deps);
  app.route("/auth", authRoutes);

  // All other routes require admin auth
  const authMiddleware = requireAdminAuth(deps);

  // Dashboard
  const dashboardRoutes = createDashboardRoutes(deps);
  app.use("/dashboard", authMiddleware);
  app.route("/dashboard", dashboardRoutes);

  // Providers
  const providerRoutes = createProviderRoutes(deps);
  app.use("/providers", authMiddleware);
  app.use("/providers/*", authMiddleware);
  app.route("/providers", providerRoutes);

  // PATs
  const patRoutes = createPatRoutes(deps);
  app.use("/pats", authMiddleware);
  app.use("/pats/*", authMiddleware);
  app.route("/pats", patRoutes);

  // Settings
  const settingsRoutes = createSettingsRoutes(deps);
  app.use("/settings", authMiddleware);
  app.use("/settings/*", authMiddleware);
  app.route("/settings", settingsRoutes);

  // Logs
  const logRoutes = createLogRoutes(deps);
  app.use("/logs", authMiddleware);
  app.use("/logs/*", authMiddleware);
  app.route("/logs", logRoutes);

  // Reload
  const reloadRoutes = createReloadRoutes(deps);
  app.use("/reload", authMiddleware);
  app.use("/reload/*", authMiddleware);
  app.route("/reload", reloadRoutes);

  // OTA
  const otaRoutes = createOtaRoutes(deps);
  app.use("/ota", authMiddleware);
  app.use("/ota/*", authMiddleware);
  app.route("/ota", otaRoutes);

  return app;
}
