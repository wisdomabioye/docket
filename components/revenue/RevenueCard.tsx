import { api } from "@/lib/trpc/server";
import { formatCents } from "@/lib/utils";

/**
 * Stage 10 dashboard summary tile. Shows the attorney's lifetime
 * Docket-share rollup (pending / invoiced / paid) plus a six-month
 * trailing list of monthly buckets sourced from `revenue.attorneySummary`.
 *
 * Server component — relies on `api.revenue.attorneySummary` being
 * RLS-scoped to the caller. Render-side, treats every cents value
 * as bigint (superjson preserves it across RSC).
 *
 * Empty state: no filed cases yet → muted "no revenue yet" message.
 * Pre-filing the only useful number is the pending bucket (fees
 * logged but not yet invoiced); we still show the section so the
 * dashboard layout doesn't pop in/out as the first case is filed.
 */
export async function RevenueCard(): Promise<React.ReactElement> {
  const summary = await api.revenue.attorneySummary();
  const { totals, months } = summary;
  const lifetimeAttorney = totals.attorneyShareCents;
  const isEmpty =
    totals.filings === 0 &&
    totals.pendingCents === 0n &&
    totals.invoicedCents === 0n &&
    totals.paidCents === 0n;

  return (
    <section
      className="rounded-md border p-5"
      style={{
        borderColor: "var(--border, rgba(0,0,0,0.1))",
        background: "var(--surface, white)",
      }}
      aria-label="Revenue summary"
    >
      <header className="flex items-baseline justify-between">
        <h2
          className="text-xs uppercase tracking-[0.2em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Revenue
        </h2>
        <span className="text-[10px] mono uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
          85 / 15 split
        </span>
      </header>

      {isEmpty ? (
        <p className="mt-3 text-sm" style={{ color: "var(--ink-muted)" }}>
          No revenue yet. Log a case fee on any case to start tracking.
        </p>
      ) : (
        <>
          <p
            className="mt-3 text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          >
            {formatCents(lifetimeAttorney)}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            Your share, lifetime · {totals.filings} {totals.filings === 1 ? "filing" : "filings"}
          </p>

          <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <BucketCell label="Pending" cents={totals.pendingCents} />
            <BucketCell label="Invoiced" cents={totals.invoicedCents} />
            <BucketCell label="Paid" cents={totals.paidCents} />
          </dl>

          {months.length > 0 ? (
            <div className="mt-4">
              <p
                className="mb-2 text-[10px] uppercase tracking-wider"
                style={{ color: "var(--ink-muted)" }}
              >
                Last 6 months · attorney share
              </p>
              <ul className="space-y-1 text-xs">
                {months.map((m) => (
                  <li
                    key={`${m.year}-${m.month}`}
                    className="flex items-baseline justify-between"
                  >
                    <span className="mono" style={{ color: "var(--ink-soft)" }}>
                      {monthLabel(m.year, m.month)}
                    </span>
                    <span className="mono">
                      {formatCents(m.attorneyCents)} · {m.filings}{" "}
                      {m.filings === 1 ? "case" : "cases"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function BucketCell({
  label,
  cents,
}: {
  label: string;
  cents: bigint;
}): React.ReactElement {
  return (
    <div>
      <dt
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--ink-muted)" }}
      >
        {label}
      </dt>
      <dd className="mt-0.5 mono text-sm">{formatCents(cents)}</dd>
    </div>
  );
}

function monthLabel(year: number, month: number): string {
  // `month` is 1-indexed from `extract(month from ...)`.
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
