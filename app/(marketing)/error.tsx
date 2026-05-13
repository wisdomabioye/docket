"use client";

import Link from "next/link";
import { useEffect } from "react";
import { APP_INFO, APP_ROUTES } from "@/config";

/**
 * Public marketing error boundary. Catches anything thrown by a
 * marketing/landing page or its data fetches. No mention of "Admin" /
 * "App" segments — visitors don't have that context — and the recovery
 * links point at public destinations only.
 */
export default function MarketingError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error("[marketing] page error", props.error);
  }, [props.error]);

  return (
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
          Something went wrong loading this page. Give it another go, or
          head back home.
        </p>
        {props.error.digest ? (
          <p
            className="mt-4 text-[10px]"
            style={{ color: "var(--ink-faint)" }}
          >
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
            href={APP_ROUTES.home}
            className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-sunken)]"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
