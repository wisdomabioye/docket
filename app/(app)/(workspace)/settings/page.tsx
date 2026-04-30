import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { formatCents, formatDate } from "@/lib/utils";
import { getMe } from "@/lib/me-cache";
import { AppPageHeader } from "@/components/layout";
import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: pageTitle("Settings") };

/**
 * Attorney settings — single-page composition (Stage 10 + Stage 11).
 *
 * Sections, top-to-bottom:
 *   1. Partnership / billing hero (85/15 split callout).
 *   2. Lifetime Docket-share summary stats.
 *   3. Past invoices list — reads `revenue.myInvoices` (RLS-scoped, so
 *      admin viewing this page sees only their own; the global admin
 *      invoice browser lives at /admin/revenue).
 *   4. Team — `EmptyState` stub (multi-seat work lands later).
 *   5. House style — `EmptyState` stub (drafting prefs land later).
 *
 * Hosted-invoice URLs deep-link from each row when populated; rows
 * with a `lastFailureReason` surface it inline so the attorney knows
 * to update payment method in Stripe before the next finalize attempt.
 */
export default async function SettingsPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await getMe();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");

  const summary = await api.revenue.attorneySummary();
  const { items: invoiceRows } = await api.revenue.myInvoices({});

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <AppPageHeader
        eyebrow="Settings"
        title="Partnership & billing"
        subtitle="Your revenue split with Docket and a list of past monthly invoices."
      />

      <section
        className="rounded-md border p-5"
        style={{
          borderColor: "var(--accent, var(--ink))",
          background: "var(--accent-soft, var(--surface-sunken, #f5f1e9))",
        }}
      >
        <div className="flex items-baseline gap-4">
          <span
            className="text-5xl tracking-tight"
            style={{ fontFamily: "var(--font-serif), Georgia, serif", color: "var(--accent, var(--ink))" }}
          >
            85<span className="text-2xl">%</span>
          </span>
          <div>
            <h2 className="text-base font-medium">You keep 85% of every case fee.</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
              Docket&rsquo;s 15% is deducted from each filing &mdash; never added on top, never charged
              before the package is approved and exported. Invoiced once monthly.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
          Lifetime Docket share
        </h2>
        <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <SummaryStat label="Pending (not yet invoiced)" cents={summary.totals.pendingCents} />
          <SummaryStat label="Invoiced (open)" cents={summary.totals.invoicedCents} />
          <SummaryStat label="Paid" cents={summary.totals.paidCents} />
        </dl>
      </section>

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
            Past invoices
          </h2>
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {invoiceRows.length} {invoiceRows.length === 1 ? "invoice" : "invoices"}
          </span>
        </header>

        {invoiceRows.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-6 text-center text-sm"
            style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
          >
            No invoices yet. Docket invoices the 15% share on the 1st of each month
            for cases filed the prior month.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
              <tr>
                <th className="pb-2 font-medium">Period</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {invoiceRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="py-3 mono text-xs">
                    {periodLabel(row.periodYear, row.periodMonth)}
                  </td>
                  <td className="py-3 mono">{formatCents(row.totalCents)}</td>
                  <td className="py-3 text-xs">
                    <InvoiceStatusPill status={row.status} />
                  </td>
                  <td className="py-3 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="py-3 text-right text-xs">
                    {row.hostedInvoiceUrl ? (
                      <Link
                        href={row.hostedInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        View &rarr;
                      </Link>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Card title="Team">
        <EmptyState
          title="Team management lands in a future release."
          subtitle="Phase 1 supports one attorney per account. Adding paralegals + co-counsel arrives with the multi-seat work."
        />
      </Card>

      <Card title="House style">
        <EmptyState
          title="Drafting preferences land in a future release."
          subtitle="Voice, exhibit-citation format, page budget, and reviewer-queue routing will live here. Today every account uses the defaults."
        />
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  cents,
}: {
  label: string;
  cents: bigint;
}): React.ReactElement {
  return (
    <div
      className="rounded-md border p-4"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
        {label}
      </p>
      <p
        className="mt-2 text-xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        {formatCents(cents)}
      </p>
    </div>
  );
}

function periodLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function InvoiceStatusPill({
  status,
}: {
  status: "draft" | "open" | "paid" | "void" | "uncollectible" | string;
}): React.ReactElement {
  const palette: Record<string, { bg: string; fg: string }> = {
    paid: { bg: "var(--success-soft, #e7f3ec)", fg: "var(--success, #1f6b3d)" },
    open: { bg: "var(--surface-sunken, #f4efe5)", fg: "var(--ink)" },
    draft: { bg: "var(--surface-sunken, #f4efe5)", fg: "var(--ink-muted)" },
    void: { bg: "var(--surface-sunken, #f4efe5)", fg: "var(--ink-muted)" },
    uncollectible: { bg: "var(--warning-soft, #fbeede)", fg: "var(--warning, #8a4a13)" },
  };
  const palette$ = palette[status] ?? palette["open"]!;
  return (
    <span
      className="rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-wider"
      style={{ background: palette$.bg, color: palette$.fg }}
    >
      {status}
    </span>
  );
}
