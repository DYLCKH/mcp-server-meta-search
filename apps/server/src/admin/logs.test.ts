import { describe, expect, it, vi } from "vitest";
import { createLogRoutes } from "./logs.js";
import type { AdminDeps, DbHandle } from "./types.js";

function createDeps(queryAuditLogs: DbHandle["queryAuditLogs"]): AdminDeps {
  return {
    configPath: "",
    runtimeState: { current: {} as AdminDeps["runtimeState"]["current"] },
    patSnapshot: { current: {} as AdminDeps["patSnapshot"]["current"] },
    db: {
      queryRequestLogs: () => [],
      queryAuditLogs,
      insertAuditLog: () => undefined,
    },
  };
}

describe("audit log routes", () => {
  it("passes the display target filter through as target", async () => {
    const queryAuditLogs = vi.fn(() => []);
    const app = createLogRoutes(createDeps(queryAuditLogs));

    const response = await app.request(
      "http://localhost/audit?action=update_settings&target=global&limit=10&offset=20",
    );

    expect(response.status).toBe(200);
    expect(queryAuditLogs).toHaveBeenCalledWith({
      action: "update_settings",
      target: "global",
      target_type: undefined,
      from: undefined,
      to: undefined,
      limit: 11,
      offset: 20,
    });
  });

  it("still supports explicit target_type filters", async () => {
    const queryAuditLogs = vi.fn(() => []);
    const app = createLogRoutes(createDeps(queryAuditLogs));

    const response = await app.request(
      "http://localhost/audit?action=update_settings&target_type=settings",
    );

    expect(response.status).toBe(200);
    expect(queryAuditLogs).toHaveBeenCalledWith({
      action: "update_settings",
      target: undefined,
      target_type: "settings",
      from: undefined,
      to: undefined,
      limit: 51,
      offset: 0,
    });
  });
});
