import { describe, expect, it } from "vitest";
import { resolveAppPath, resolveStaticAssetPath } from "./path-utils.js";

describe("resolveAppPath", () => {
  it("resolves relative paths against the provided base dir", () => {
    expect(resolveAppPath("config.jsonc", "/srv/meta-search")).toBe(
      "/srv/meta-search/config.jsonc",
    );
  });

  it("keeps absolute paths unchanged", () => {
    expect(resolveAppPath("/etc/meta-search/config.jsonc", "/srv/meta-search")).toBe(
      "/etc/meta-search/config.jsonc",
    );
  });
});

describe("resolveStaticAssetPath", () => {
  it("resolves assets inside the web root", () => {
    expect(resolveStaticAssetPath("/srv/meta-search/apps/web/public", "/pages/dashboard.js")).toBe(
      "/srv/meta-search/apps/web/public/pages/dashboard.js",
    );
  });

  it("rejects path traversal attempts", () => {
    expect(resolveStaticAssetPath("/srv/meta-search/apps/web/public", "/../../package.json")).toBeNull();
  });

  it("rejects malformed escape sequences", () => {
    expect(resolveStaticAssetPath("/srv/meta-search/apps/web/public", "/%E0%A4%A")).toBeNull();
  });
});
