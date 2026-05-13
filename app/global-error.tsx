"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { APP_INFO, APP_ROUTES } from "@/config";
import "./globals.css";

/**
 * Last-resort error boundary. Fires only when the segment-level
 * `(app)/error.tsx`, `(admin)/error.tsx`, or `(marketing)/error.tsx`
 * boundaries themselves throw — at that point the root layout has
 * been replaced, so this file is responsible for its own `<html>` +
 * `<body>` chrome.
 *
 * Brand chrome is reachable here via `./globals.css` (CSS tokens +
 * Tailwind 4 layers). Components from `@/components/*` are NOT
 * imported — they assume the root layout's font + theme providers,
 * which haven't mounted at this scope.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}): React.ReactElement {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          className="flex min-h-screen items-center justify-center px-6"
          style={{ background: "var(--cream, #f5f1e8)" }}
        >
          <div className="max-w-md text-center">
            <p
              className="text-xs uppercase tracking-[0.3em]"
              style={{ color: "var(--ink-muted)" }}
            >
              Error
            </p>
            <h1
              className="mt-4 text-5xl tracking-tight"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {APP_INFO.name}
              <span style={{ color: "var(--accent, var(--ink))" }}>.</span>
            </h1>
            <p
              className="mt-4 text-base"
              style={{ color: "var(--ink-soft)" }}
            >
              Something went wrong. The page couldn&rsquo;t recover on its
              own — refresh, or come back to the landing page.
            </p>
            {error.digest ? (
              <p
                className="mt-4 text-[10px]"
                style={{ color: "var(--ink-faint)" }}
              >
                ref: <code className="mono">{error.digest}</code>
              </p>
            ) : null}
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-sm border border-[var(--ink)] px-4 py-2 text-sm hover:bg-[var(--surface-sunken)]"
              >
                Refresh
              </button>
              <Link
                href={APP_ROUTES.home}
                className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-sunken)]"
              >
                Home
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
