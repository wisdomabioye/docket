"use client";

import Link from "next/link";
import { useEffect } from "react";
import { APP_ROUTES } from "@/config";

/**
 * Admin error boundary. Catches anything the admin layout's auth probe
 * propagates (DB down, network blip, runtime crash inside a page) and
 * renders a styled fallback instead of the framework default. Sidebar
 * isn't reachable from this boundary — it lives outside the page tree —
 * but we link back to dashboard + retry so the user has a way out.
 */
export default function AdminError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Digest is the Next-generated correlation id. Logging here is
    // belt-and-suspenders; Sentry's beforeSend hook (Stage 12) will
    // dedupe upstream.
    console.error("[admin] page error", props.error);
  }, [props.error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12 text-center">
      <p className="eyebrow">Admin · Error</p>
      <h1
        className="mt-2 text-2xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        Something went wrong here.
      </h1>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        The admin page couldn’t load. Try again, or head back to the
        dashboard if it persists.
      </p>
      {props.error.digest ? (
        <p className="mt-4 text-[10px] text-[var(--ink-faint)]">
          ref:{" "}
          <code className="mono">{props.error.digest}</code>
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
