import type { MetadataRoute } from "next";
import { APP_INFO } from "@/config";
import { env } from "@/config/env";

/**
 * `production` allows everything; preview/dev disallows everything to
 * keep staging URLs out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  const isProd = env.NODE_ENV === "production";
  return {
    rules: isProd
      ? {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/api/",
            "/dashboard",
            "/admin",
            "/case",
            "/settings",
            "/onboarding",
          ],
        }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${APP_INFO.productionUrl}/sitemap.xml`,
  };
}
