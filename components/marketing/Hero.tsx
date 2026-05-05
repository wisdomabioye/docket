import Link from "next/link";
import { APP_INFO, APP_ROUTES } from "@/config";

/**
 * Stage 11 landing hero. Mirrors `landing.html` `header.mkt-wrap.hero`
 * (l. 494–525): eyebrow + serif headline (with italic break) + sub +
 * CTA row + 3-stat proof strip + decorative document stack.
 *
 * Stats are hardcoded per current marketing copy; expose as props if
 * Phase 2 needs A/B-tested variants.
 */
export function Hero(): React.ReactElement {
  return (
    <header className="mx-auto max-w-6xl px-6 pb-16 pt-12 sm:pt-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
        <div className="max-w-2xl">
          <p
            className="text-xs uppercase tracking-[0.3em]"
            style={{ color: "var(--ink-muted)" }}
          >
            Built for the solo immigration attorney
          </p>
          <h1
            className="mt-4 text-4xl leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            80 hours of case&nbsp;prep.
            <br />
            <em
              className="not-italic"
              style={{
                fontStyle: "italic",
                color: "var(--accent, var(--ink))",
              }}
            >
              Done in one.
            </em>
          </h1>
          <p
            className="mt-5 text-lg leading-relaxed"
            style={{ color: "var(--ink-soft, var(--ink))" }}
          >
            {APP_INFO.name} is the AI associate for solo immigration attorneys.
            Computer-powered case prep for O-1, EB-1, and beyond — evidence
            plans, personal statements, petition letters, exhibit indices,
            recommendation templates. Filing-ready packages in days, not weeks.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="#waitlist"
              className="rounded-md bg-[var(--ink)] px-5 py-3 text-sm font-medium text-[var(--cream)] transition hover:opacity-90"
            >
              Join the waitlist →
            </Link>
            <Link
              href="#how"
              className="text-sm underline-offset-2 hover:underline"
              style={{ color: "var(--ink-muted)" }}
            >
              See how it works ↓
            </Link>
            <span
              className="hidden h-4 w-px sm:inline-block"
              style={{ background: "var(--border, rgba(0,0,0,0.15))" }}
              aria-hidden="true"
            />
            <Link
              href={APP_ROUTES.login}
              className="text-sm underline-offset-2 hover:underline"
              style={{ color: "var(--ink-muted)" }}
            >
              Already invited? Sign in →
            </Link>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            <ProofStat number="5+" label="Partner attorneys in active beta" />
            <ProofStat number="40+" label="Cases processed through Docket" />
            <ProofStat number="12 days" label="Average attorney-to-filing time" />
          </div>
        </div>

        <DocumentStackVisual />
      </div>
    </header>
  );
}

function ProofStat(props: {
  number: string;
  label: string;
}): React.ReactElement {
  return (
    <div>
      <p
        className="text-3xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        {props.number}
      </p>
      <p
        className="mt-1 text-xs leading-snug"
        style={{ color: "var(--ink-muted)" }}
      >
        {props.label}
      </p>
    </div>
  );
}

function DocumentStackVisual(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="relative hidden h-[420px] lg:block"
    >
      <div
        className="absolute right-12 top-8 h-[360px] w-[260px] rotate-[-3deg] rounded-md border"
        style={{
          background: "var(--surface, white)",
          borderColor: "var(--border, rgba(0,0,0,0.1))",
          boxShadow: "0 12px 32px rgba(0,0,0,0.05)",
        }}
      />
      <div
        className="absolute right-2 top-2 h-[360px] w-[260px] rotate-[2deg] rounded-md border p-6"
        style={{
          background: "var(--surface, white)",
          borderColor: "var(--border, rgba(0,0,0,0.1))",
          boxShadow: "0 16px 40px rgba(0,0,0,0.08)",
        }}
      >
        <p
          className="mono text-[10px] uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          Exhibit A · Personal Statement
        </p>
        <p
          className="mt-3 text-sm font-semibold leading-snug"
          style={{ color: "var(--ink)" }}
        >
          Personal Statement of Dr. Maria Gonzalez
        </p>
        <div className="mt-4 space-y-2">
          {LINE_WIDTHS.map((w, idx) => (
            <div
              key={idx}
              className="h-2 rounded-sm"
              style={{
                width: w,
                background: "var(--surface-sunken, rgba(0,0,0,0.06))",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const LINE_WIDTHS: ReadonlyArray<string> = [
  "100%",
  "92%",
  "88%",
  "60%",
  "100%",
  "84%",
  "70%",
];
