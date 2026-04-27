import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth/config";
import { APP_ROUTES, PUBLIC_ROUTES } from "@/config";

/**
 * Next 16 proxy (was `middleware.ts`). Runs on every matched request.
 * Edge runtime is NOT supported in proxy — runs in node, which is what we
 * need for Auth.js's database session check.
 *
 * Responsibilities:
 *   1. Optimistic check that the user is signed in for non-public routes.
 *      If not, redirect to /login with a callbackUrl.
 *   2. Bounce already-signed-in users away from /login.
 *
 * Notes:
 *   - We do NOT set the RLS GUC here. That happens in tRPC middleware, so
 *     pages that don't query the DB don't pay for an idle transaction.
 *   - This is an *optimistic* gate, not authorization. The real auth check
 *     lives in tRPC's `protectedProcedure` middleware. A user who somehow
 *     bypasses the proxy still hits tRPC's UNAUTHORIZED.
 */

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = isPublicRoute(pathname);

  const session = await auth();
  const signedIn = Boolean(session?.user);

  if (signedIn && pathname === APP_ROUTES.login) {
    return NextResponse.redirect(new URL(APP_ROUTES.dashboard, request.url));
  }

  if (!signedIn && !isPublic) {
    const url = new URL(APP_ROUTES.login, request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  // Treat /api/auth/* and /auth/* as public (Auth.js callback paths).
  return (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export const config = {
  // Skip static assets + tRPC + webhook endpoints (those have their own
  // auth checks). Skip /api/auth so Auth.js's own routes work freely.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/trpc|api/webhooks|api/auth|api/health).*)",
  ],
};
