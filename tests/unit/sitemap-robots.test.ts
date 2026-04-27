import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { APP_INFO, APP_ROUTES } from "@/config";

/**
 * Sitemap should expose only marketing pages, not auth callback URLs.
 * Robots disallow list should cover every authenticated route prefix.
 */

describe("sitemap()", () => {
  it("includes core marketing pages", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${APP_INFO.productionUrl}${APP_ROUTES.home}`);
    expect(urls).toContain(`${APP_INFO.productionUrl}${APP_ROUTES.terms}`);
    expect(urls).toContain(`${APP_INFO.productionUrl}${APP_ROUTES.privacy}`);
    expect(urls).toContain(`${APP_INFO.productionUrl}${APP_ROUTES.pricing}`);
  });

  it("excludes auth callback URLs", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).not.toContain(`${APP_INFO.productionUrl}${APP_ROUTES.login}`);
    expect(urls).not.toContain(
      `${APP_INFO.productionUrl}${APP_ROUTES.authCallback}`,
    );
    expect(urls).not.toContain(
      `${APP_INFO.productionUrl}${APP_ROUTES.authError}`,
    );
  });

  it("gives the home page top priority", () => {
    const home = sitemap().find(
      (e) => e.url === `${APP_INFO.productionUrl}${APP_ROUTES.home}`,
    );
    expect(home?.priority).toBe(1.0);
  });
});

describe("robots()", () => {
  it("disallows authenticated routes (incl. /onboarding)", () => {
    const r = robots();
    const rule = r.rules as { disallow?: string | string[] };
    const disallowed = Array.isArray(rule.disallow)
      ? rule.disallow
      : rule.disallow
        ? [rule.disallow]
        : [];
    if (process.env.NODE_ENV === "production") {
      expect(disallowed).toEqual(
        expect.arrayContaining([
          "/api/",
          "/dashboard",
          "/admin",
          "/case",
          "/settings",
          "/onboarding",
        ]),
      );
    } else {
      // Dev/test env: catch-all disallow.
      expect(disallowed).toContain("/");
    }
  });

  it("points at the production sitemap", () => {
    expect(robots().sitemap).toBe(`${APP_INFO.productionUrl}/sitemap.xml`);
  });
});
