import Link from "next/link";
import { APP_ROUTES } from "@/config";

/**
 * Auth.js redirects here when sign-in fails. The `?error=...` query param
 * carries the code. Known codes get tailored copy; everything else falls
 * through to a generic message with the raw code displayed for support.
 *
 * Codes we surface explicitly:
 *   - `not-invited`        — invite-gate rejection (see `invite-gate.ts`)
 *   - `inactive`           — attorney profile suspended/deactivated
 *   - `suspended`          — same, distinct admin action
 *   - `session-mismatch`   — RSC saw a session whose user row was deleted
 *   - `AccessDenied`       — Auth.js default for any `signIn` callback
 *                            returning false (kept as a safety net)
 */

const COPY: Record<string, { title: string; body: React.ReactNode; cta: { href: string; label: string } }> = {
  "not-invited": {
    title: "You’re not on the invite list yet",
    body: (
      <>
        Docket is invite-only during the early-access phase. Join the
        waitlist and we’ll reach out as soon as a spot opens up.
      </>
    ),
    cta: { href: APP_ROUTES.home, label: "Join the waitlist" },
  },
  inactive: {
    title: "Account pending review",
    body: (
      <>
        Your onboarding submission is in. We’ll email you the moment it’s
        approved — usually within one business day.
      </>
    ),
    cta: { href: APP_ROUTES.home, label: "Back to homepage" },
  },
  suspended: {
    title: "Account suspended",
    body: (
      <>
        Access to this account is paused. Contact{" "}
        <a className="underline" href="mailto:hello@trydocketapp.com">hello@trydocketapp.com</a>{" "}
        if you believe this is in error.
      </>
    ),
    cta: { href: APP_ROUTES.home, label: "Back to homepage" },
  },
  "session-mismatch": {
    title: "Session expired",
    body: <>Your sign-in session is no longer valid. Please sign in again.</>,
    cta: { href: APP_ROUTES.login, label: "Sign in" },
  },
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const code = params.error ?? "unknown";
  const known = COPY[code];

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {known?.title ?? "Sign-in failed"}
        </h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {known?.body ?? (
            <>
              Code: <code className="font-mono">{code}</code>
            </>
          )}
        </p>
        <Link
          href={known?.cta.href ?? APP_ROUTES.login}
          className="inline-block rounded-md border border-[var(--color-ink)] px-4 py-2 text-sm"
        >
          {known?.cta.label ?? "Try again"}
        </Link>
      </div>
    </main>
  );
}
