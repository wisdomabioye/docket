import { PUBLIC_ROUTES } from "@/config";

/**
 * Pure URL classifier used by `proxy.ts`. Extracted into its own module
 * so the rules can be unit-tested without importing NextRequest or
 * Auth.js (both of which need a runtime).
 *
 * A path is "public" if:
 *   - it appears verbatim in `PUBLIC_ROUTES`, OR
 *   - it begins with one of the framework / auth prefixes below
 *     (Auth.js handler, OAuth callback page, Next static, favicon).
 */
export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/favicon.ico";
}

const PUBLIC_PREFIXES = ["/api/auth", "/auth/", "/_next/"] as const;
