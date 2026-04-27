// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// `auth()` is called by `proxy()` on every request — mock it so tests
// can simulate signed-in / signed-out without exercising next-auth's
// internals. `vi.hoisted` lets the mock fn coexist with the hoisted
// `vi.mock` factory.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/server/auth/config", () => ({
  auth: authMock,
}));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { APP_ROUTES } from "@/config";

/**
 * End-to-end behavioral tests for `proxy.ts` (Next 16's middleware
 * replacement). Constructs real NextRequest objects and asserts the
 * redirect/passthrough behavior across signed-in/out × public/private
 * route combinations.
 *
 * The classifier itself is unit-tested in `tests/unit/route-classifier.test.ts`;
 * this file proves the proxy *uses* it correctly and chains the right
 * NextResponse outputs.
 */

const ORIGIN = "http://localhost:3000";

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, ORIGIN));
}

beforeEach(() => {
  authMock.mockReset();
});

describe("proxy — auth gating", () => {
  it("redirects signed-out users on private routes to /login with callbackUrl", async () => {
    authMock.mockResolvedValue(null);
    const res = await proxy(makeRequest("/dashboard"));
    expect(res.status).toBe(307); // NextResponse.redirect default
    const loc = res.headers.get("location")!;
    expect(loc).toContain(APP_ROUTES.login);
    expect(loc).toContain("callbackUrl=%2Fdashboard");
  });

  it("redirects signed-in users away from /login → /dashboard", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const res = await proxy(makeRequest(APP_ROUTES.login));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(APP_ROUTES.dashboard);
  });

  it("lets signed-in users through on private routes", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const res = await proxy(makeRequest("/dashboard"));
    // NextResponse.next() is status 200 with no Location header.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets signed-out users through on public marketing routes", async () => {
    authMock.mockResolvedValue(null);
    for (const route of [APP_ROUTES.home, APP_ROUTES.pricing, APP_ROUTES.terms]) {
      const res = await proxy(makeRequest(route));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("lets signed-out users through on Auth.js callback paths", async () => {
    authMock.mockResolvedValue(null);
    const res = await proxy(makeRequest("/api/auth/callback/google"));
    expect(res.status).toBe(200);
  });

  it("preserves the original path as callbackUrl on deep private routes", async () => {
    authMock.mockResolvedValue(null);
    const res = await proxy(makeRequest("/case/abc123/intake"));
    const loc = res.headers.get("location")!;
    expect(loc).toContain("callbackUrl=%2Fcase%2Fabc123%2Fintake");
  });

  it("does not bounce signed-in users away from public pages", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    // /pricing is public; signed-in users can still visit.
    const res = await proxy(makeRequest(APP_ROUTES.pricing));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
