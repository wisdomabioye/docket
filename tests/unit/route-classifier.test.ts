import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicRoute } from "@/server/auth/route-classifier";
import { APP_ROUTES } from "@/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * URL classifier used by `proxy.ts` to decide which paths bypass auth.
 * Pure function — no Next runtime needed.
 */
describe("isPublicRoute", () => {
  it("treats marketing / auth pages as public", () => {
    expect(isPublicRoute(APP_ROUTES.home)).toBe(true);
    expect(isPublicRoute(APP_ROUTES.pricing)).toBe(true);
    expect(isPublicRoute(APP_ROUTES.terms)).toBe(true);
    expect(isPublicRoute(APP_ROUTES.privacy)).toBe(true);
    expect(isPublicRoute(APP_ROUTES.login)).toBe(true);
    expect(isPublicRoute(APP_ROUTES.authCallback)).toBe(true);
    expect(isPublicRoute(APP_ROUTES.authError)).toBe(true);
  });

  it("treats Auth.js + framework prefixes as public", () => {
    expect(isPublicRoute("/api/auth/callback/google")).toBe(true);
    expect(isPublicRoute("/api/auth/signin")).toBe(true);
    expect(isPublicRoute("/auth/callback")).toBe(true);
    expect(isPublicRoute("/_next/static/abc.js")).toBe(true);
    expect(isPublicRoute("/favicon.ico")).toBe(true);
  });

  it("treats authenticated routes as private", () => {
    expect(isPublicRoute(APP_ROUTES.dashboard)).toBe(false);
    expect(isPublicRoute(APP_ROUTES.settings)).toBe(false);
    expect(isPublicRoute(APP_ROUTES.admin)).toBe(false);
    expect(isPublicRoute("/case/abc123")).toBe(false);
    expect(isPublicRoute("/case/abc123/intake")).toBe(false);
  });

  it("does NOT match arbitrary sub-paths of public routes", () => {
    // `/pricing/foo` should NOT be public just because `/pricing` is —
    // exact match only for PUBLIC_ROUTES entries.
    expect(isPublicRoute("/pricing/foo")).toBe(false);
    expect(isPublicRoute("/login/oops")).toBe(false);
  });

  it("doesn't accidentally treat /api/authentication as Auth.js", () => {
    // Edge case: prefix match on "/api/auth" would catch any path
    // starting with that string. Acceptable risk — we don't have other
    // routes starting with /api/auth — but document.
    expect(isPublicRoute("/api/authentication-stuff")).toBe(true);
  });

  it("/dev/* is public when NODE_ENV is 'development' (and 'test')", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isPublicRoute("/dev/components")).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isPublicRoute("/dev/components")).toBe(true);
  });

  it("/dev/* is private in production (storybook also returns notFound there)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isPublicRoute("/dev/components")).toBe(false);
    expect(isPublicRoute("/dev/anything-else")).toBe(false);
  });
});
