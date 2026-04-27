import { describe, expect, it } from "vitest";
import { APP_INFO, APP_ROUTES, API_ROUTES, PUBLIC_ROUTES } from "@/config";

describe("config", () => {
  it("exposes app identity", () => {
    expect(APP_INFO.name).toBe("Docket");
    expect(APP_INFO.productionUrl).toMatch(/^https:\/\//);
  });

  it("renders parameterized routes", () => {
    expect(APP_ROUTES.dashboard).toBe("/dashboard");
    expect(APP_ROUTES.case("abc123")).toBe("/case/abc123");
    expect(APP_ROUTES.output("c1", "o1")).toBe("/case/c1/outputs/o1");
  });

  it("declares API endpoints", () => {
    expect(API_ROUTES.health).toBe("/api/health");
    expect(API_ROUTES.trpc).toBe("/api/trpc");
    expect(API_ROUTES.webhooks.stripe).toBe("/api/webhooks/stripe");
  });

  it("includes login in PUBLIC_ROUTES", () => {
    expect(PUBLIC_ROUTES).toContain(APP_ROUTES.login);
    expect(PUBLIC_ROUTES).toContain(APP_ROUTES.home);
  });
});
