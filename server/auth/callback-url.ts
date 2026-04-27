import { APP_ROUTES } from "@/config";

/**
 * Validate an Auth.js `callbackUrl` query parameter. Returns the input if
 * it's a same-origin path (`/...`); otherwise falls back to `/dashboard`.
 *
 * Why: a raw `?callbackUrl=https://evil.com` would make sign-in redirect
 * the user off-site after authenticating — a classic open-redirect. We
 * accept only relative paths and reject protocol-relative URLs (`//host`).
 */
export function safeCallbackUrl(input: string | undefined | null): string {
  if (!input) return APP_ROUTES.dashboard;
  if (!input.startsWith("/")) return APP_ROUTES.dashboard;
  if (input.startsWith("//")) return APP_ROUTES.dashboard;
  return input;
}
