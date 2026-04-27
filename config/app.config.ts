/**
 * App identity. Imported by both server and client code.
 */

export const APP_INFO = {
  name: "Docket",
  displayName: "Docket.",
  tagline: "AI-powered case prep for U.S. immigration attorneys.",
  productionDomain: "docket.law",
  productionUrl: "https://docket.law",
  supportEmail: "support@docket.law",
} as const;

export type AppInfo = typeof APP_INFO;

/** `pageTitle("Dashboard")` → "Dashboard · Docket". Empty input → bare brand. */
export function pageTitle(segment?: string): string {
  return segment ? `${segment} · ${APP_INFO.name}` : APP_INFO.displayName;
}
