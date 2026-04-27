import type { MetadataRoute } from "next";
import { APP_INFO, APP_ROUTES } from "@/config";

/**
 * Public sitemap — only the *marketing* pages we want indexed.
 * `PUBLIC_ROUTES` also includes `/login` and Auth.js callback paths;
 * those should not be advertised to search engines.
 */
const SITEMAP_ROUTES = [
  APP_ROUTES.home,
  APP_ROUTES.pricing,
  APP_ROUTES.terms,
  APP_ROUTES.privacy,
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = APP_INFO.productionUrl;
  const now = new Date();
  return SITEMAP_ROUTES.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === APP_ROUTES.home ? "weekly" : "monthly",
    priority: path === APP_ROUTES.home ? 1.0 : 0.7,
  }));
}
