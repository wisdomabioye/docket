import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/server/auth/callback-url";
import { APP_ROUTES } from "@/config";

/**
 * Open-redirect protection for Auth.js's `callbackUrl` query parameter.
 * Same-origin paths only — anything else falls back to /dashboard.
 */
describe("safeCallbackUrl", () => {
  it("accepts a same-origin path", () => {
    expect(safeCallbackUrl("/dashboard")).toBe("/dashboard");
    expect(safeCallbackUrl("/case/abc123")).toBe("/case/abc123");
    expect(safeCallbackUrl("/admin/cases?status=draft")).toBe(
      "/admin/cases?status=draft",
    );
  });

  it("rejects an absolute external URL", () => {
    expect(safeCallbackUrl("https://evil.com")).toBe(APP_ROUTES.dashboard);
    expect(safeCallbackUrl("http://evil.com/x")).toBe(APP_ROUTES.dashboard);
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeCallbackUrl("//evil.com")).toBe(APP_ROUTES.dashboard);
    expect(safeCallbackUrl("//evil.com/x")).toBe(APP_ROUTES.dashboard);
  });

  it("rejects a JavaScript scheme", () => {
    expect(safeCallbackUrl("javascript:alert(1)")).toBe(APP_ROUTES.dashboard);
  });

  it("falls back to /dashboard for missing input", () => {
    expect(safeCallbackUrl(undefined)).toBe(APP_ROUTES.dashboard);
    expect(safeCallbackUrl(null)).toBe(APP_ROUTES.dashboard);
    expect(safeCallbackUrl("")).toBe(APP_ROUTES.dashboard);
  });

  it("rejects bare paths without a leading slash", () => {
    expect(safeCallbackUrl("dashboard")).toBe(APP_ROUTES.dashboard);
    expect(safeCallbackUrl("./dashboard")).toBe(APP_ROUTES.dashboard);
  });
});
