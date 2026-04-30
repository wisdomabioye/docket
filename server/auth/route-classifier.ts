import { PUBLIC_ROUTES } from "@/config";

/**
 * Pure URL classifier used by `proxy.ts`. Extracted into its own module
 * so the rules can be unit-tested without importing NextRequest or
 * Auth.js (both of which need a runtime).
 *
 * A path is "public" if:
 *   - it appears verbatim in `PUBLIC_ROUTES`, OR
 *   - it begins with one of the framework / auth prefixes below
 *     (Auth.js handler, OAuth callback page, Next static, favicon), OR
 *   - it begins with `/dev/` AND `NODE_ENV !== "production"`. The
 *     `(dev)` route group hosts the storybook (`/dev/components`); the
 *     route's own page calls `notFound()` in production, so even if a
 *     misconfigured proxy let `/dev/*` through in prod, no content
 *     would render.
 */
export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  if (pathname === "/favicon.ico") return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (
    process.env.NODE_ENV !== "production" &&
    pathname.startsWith("/dev/")
  ) {
    return true;
  }
  return false;
}

const PUBLIC_PREFIXES = ["/api/auth", "/auth/", "/_next/"] as const;
