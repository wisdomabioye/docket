import Link from "next/link";
import { APP_ROUTES } from "@/config";

/**
 * Auth.js redirects here when sign-in fails for a reason it can't surface
 * inline (e.g., misconfigured provider). The query param `?error=...`
 * carries the code; we mostly just funnel the user back to /login which
 * displays the friendly message.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ?? "unknown";

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1
          className="text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Sign-in failed
        </h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Code: <code className="font-mono">{error}</code>
        </p>
        <Link
          href={APP_ROUTES.login}
          className="inline-block rounded-md border border-[var(--color-ink)] px-4 py-2 text-sm"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
