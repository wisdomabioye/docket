import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard, KpiGrid } from "@/components/kpi";
import { Card, EmptyState, ProgressBar } from "@/components/ui";
import { Filters, type Chip } from "@/components/table";
import { formatCents } from "@/lib/utils";

export const metadata = { title: pageTitle("Revenue") };

const PERIOD_CHIPS: ReadonlyArray<{
  label: string;
  period: "MTD" | "QTD" | "YTD" | "ALL";
}> = [
  { label: "MTD", period: "MTD" },
  { label: "QTD", period: "QTD" },
  { label: "YTD", period: "YTD" },
  { label: "All time", period: "ALL" },
];

export default async function AdminRevenuePage(props: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const params = await props.searchParams;
  const period = parsePeriod(params.period) ?? "QTD";

  let data: Awaited<ReturnType<typeof api.admin.getRevenueMetrics>>;
  try {
    data = await api.admin.getRevenueMetrics({ period });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

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
          empty={empty}
          sub={empty ? "Awaiting first filing" : `${data.totals.filings} filings`}
        />
        <KpiCard
          label={`Docket share · ${period}`}
          value={formatCents(data.totals.docketCents)}
          empty={empty}
          sub={empty ? "—" : "15% of gross"}
        />
        <KpiCard
          label={`Attorney payouts · ${period}`}
          value={formatCents(data.totals.attorneyCents)}
          empty={empty}
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
    </>
  );
}

function parsePeriod(raw: string | undefined): "MTD" | "QTD" | "YTD" | "ALL" | undefined {
  return raw === "MTD" || raw === "QTD" || raw === "YTD" || raw === "ALL"
    ? raw
    : undefined;
}
