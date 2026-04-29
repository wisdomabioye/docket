import Link from "next/link";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard, KpiGrid } from "@/components/kpi";
import { Card, EmptyState, ProgressBar } from "@/components/ui";
import { Filters, type Chip } from "@/components/table";
import { formatCents } from "@/lib/utils";
import { parseEnum } from "@/lib/url-params";
import {
  AdminInvoicePanel,
  type AttorneyOption,
} from "@/components/revenue/AdminInvoicePanel";

export const metadata = { title: pageTitle("Revenue") };

const PERIODS = ["MTD", "QTD", "YTD", "ALL"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_CHIPS: ReadonlyArray<{ label: string; period: Period }> = [
  { label: "MTD", period: "MTD" },
  { label: "QTD", period: "QTD" },
  { label: "YTD", period: "YTD" },
  { label: "All time", period: "ALL" },
];

export default async function AdminRevenuePage(props: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.ReactElement> {
  const params = await props.searchParams;
  const period = parseEnum<Period>(params.period, PERIODS) ?? "QTD";
  const [data, byAttorney, recentInvoices] = await Promise.all([
    api.admin.getRevenueMetrics({ period }),
    api.admin.getRevenueByAttorney({ period }),
    api.revenue.adminListInvoices({}),
  ]);

  // The invoice panel needs a complete attorney roster (not just the
  // top-10 in `byAttorney`). Pull from the all-time aggregate so the
  // dropdown isn't truncated when the current period is empty.
  const allTimeByAttorney = period === "ALL"
    ? byAttorney
    : await api.admin.getRevenueByAttorney({ period: "ALL" });
  const attorneyOptions: ReadonlyArray<AttorneyOption> = allTimeByAttorney.items.map(
    (a) => ({
      userId: a.userId,
      label: a.name ? `${a.name} · ${a.email}` : a.email,
    }),
  );

  const empty = data.totals.filings === 0;
  const chips: Chip[] = PERIOD_CHIPS.map((c) => ({
    label: c.label,
    href: `${APP_ROUTES.adminRevenue}?period=${c.period}`,
    active: period === c.period,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Revenue"]}
        title="Revenue"
        subtitle="Gross, Docket share, and per-visa breakdown. Reconciles to filed cases."
      />

      <Filters chips={chips} right={`Period: ${period}`} />

      <KpiGrid cols={3}>
        <KpiCard
          label={`Gross · ${period}`}
          value={formatCents(data.totals.grossCents)}
          dim={empty}
          sub={empty ? "Awaiting first filing" : `${data.totals.filings} filings`}
        />
        <KpiCard
          label={`Docket share · ${period}`}
          value={formatCents(data.totals.docketCents)}
          dim={empty}
          sub={empty ? "—" : "15% of gross"}
        />
        <KpiCard
          label={`Attorney payouts · ${period}`}
          value={formatCents(data.totals.attorneyCents)}
          dim={empty}
          sub={empty ? "—" : "85% of gross"}
        />
      </KpiGrid>

      <div className="mt-6">
        <Card title={`Mix by visa · ${period}`}>
          {data.byVisa.length === 0 ? (
            <EmptyState
              title="No filings in this period."
              subtitle="Once attorneys file cases, the visa-mix breakdown shows here."
            />
          ) : (
            <ul className="space-y-3">
              {data.byVisa.map((row) => {
                const pct =
                  data.totals.docketCents > 0n
                    ? Number((row.cents * 1000n) / data.totals.docketCents) / 10
                    : 0;
                return (
                  <li key={row.visa} className="text-sm">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="mono">{row.visa}</span>
                      <span className="mono text-xs text-[var(--ink-muted)]">
                        {formatCents(row.cents)} · {pct.toFixed(0)}% · {row.count}
                      </span>
                    </div>
                    <ProgressBar value={pct} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title={`Top attorneys by docket share · ${period}`}>
          {byAttorney.items.length === 0 ? (
            <EmptyState
              title="No filings attributed to attorneys yet."
              subtitle="Per-attorney rollup populates from filed cases."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {byAttorney.items.map((row, idx) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between border-b py-2 text-xs last:border-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="mono text-[var(--ink-muted)]"
                      style={{ width: "1.5em" }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <Link
                      href={`${APP_ROUTES.adminAttorneys}/${row.userId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {row.name ?? row.email}
                    </Link>
                  </span>
                  <span className="mono">
                    {formatCents(row.docketCents)} · {row.filings} filings
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Generate monthly invoice">
          <AdminInvoicePanel attorneys={attorneyOptions} />
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Recent invoices"
          meta={`${recentInvoices.items.length} latest`}
        >
          {recentInvoices.items.length === 0 ? (
            <EmptyState
              title="No invoices yet."
              subtitle="Generate the first monthly invoice for an attorney above."
            />
          ) : (
            <table className="w-full text-sm">
              <thead
                className="text-left text-[10px] uppercase tracking-wider"
                style={{ color: "var(--ink-muted)" }}
              >
                <tr>
                  <th className="pb-2 font-medium">Attorney</th>
                  <th className="pb-2 font-medium">Period</th>
                  <th className="pb-2 font-medium">Total</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {recentInvoices.items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="py-2 text-xs">
                      <Link
                        href={`${APP_ROUTES.adminAttorneys}/${row.attorneyId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {row.attorneyName ?? row.attorneyEmail}
                      </Link>
                    </td>
                    <td className="py-2 mono text-xs">
                      {row.periodYear}-{String(row.periodMonth).padStart(2, "0")}
                    </td>
                    <td className="py-2 mono text-xs">{formatCents(row.totalCents)}</td>
                    <td className="py-2 text-xs uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                      {row.status}
                      {row.lastFailureReason ? (
                        <span
                          className="ml-2 mono normal-case"
                          style={{ color: "var(--warning, #8a4a13)" }}
                          title={row.lastFailureReason}
                        >
                          ⚠
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right text-xs">
                      {row.hostedInvoiceUrl ? (
                        <Link
                          href={row.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          Open &rarr;
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
        </Card>
      </div>
    </>
  );
}

