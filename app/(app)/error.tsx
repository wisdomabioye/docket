"use client";

import Link from "next/link";
import { useEffect } from "react";
import { APP_ROUTES } from "@/config";

/**
 * Authenticated-app error boundary. Catches anything thrown inside the
 * (app) segment — tRPC failures inside a server component, runtime
 * crashes in a client child, the auth-probe propagating in the
 * layout — and renders a branded fallback instead of the framework
 * default. Mirrors `app/(admin)/error.tsx` so the two segments share
 * the same recovery shape.
 *
 * Sentry capture happens upstream via `instrumentation-client.ts`'s
 * `onRequestError` hook; the in-component log is belt-and-suspenders
 * so the digest still surfaces in browser devtools when Sentry is
 * unreachable.
 */
export default function AppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error("[app] page error", props.error);
  }, [props.error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12 text-center">
      <p className="eyebrow">Error</p>
      <h1
        className="mt-2 text-2xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        Something went wrong loading this page.
      </h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        Try again, or head back to the dashboard if it persists. Your
        work is saved — only this view failed.
      </p>
      {props.error.digest ? (
        <p className="mt-4 text-[10px] text-[var(--ink-faint)]">
          ref: <code className="mono">{props.error.digest}</code>
        </p>
      ) : null}
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => props.reset()}
          className="rounded-sm border border-[var(--ink)] px-4 py-2 text-sm hover:bg-[var(--surface-sunken)]"
        >
          Try again
        </button>
        <Link
          href={APP_ROUTES.dashboard}
          className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-sunken)]"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
