import Link from "next/link";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard, KpiGrid } from "@/components/kpi";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Filters, type Chip } from "@/components/table";
import { formatCents } from "@/lib/utils";
import { parseEnum } from "@/lib/url-params";

export const metadata = { title: pageTitle("Compute & models") };

const PERIODS = ["7d", "30d", "MTD", "QTD"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_CHIPS: ReadonlyArray<{ label: string; period: Period }> = [
  { label: "7d", period: "7d" },
  { label: "30d", period: "30d" },
  { label: "MTD", period: "MTD" },
  { label: "QTD", period: "QTD" },
];

export default async function AdminComputePage(props: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.ReactElement> {
  const params = await props.searchParams;
  const period = parseEnum<Period>(params.period, PERIODS) ?? "MTD";
  const [data, breakdown, health] = await Promise.all([
    api.admin.getComputeMetrics({ period }),
    api.admin.getComputeBreakdown({ period }),
    api.admin.getComputerHealthSnapshot(),
  ]);

  const empty = data.totals.entries === 0;
  const chips: Chip[] = PERIOD_CHIPS.map((c) => ({
    label: c.label,
    href: `${APP_ROUTES.adminCompute}?period=${c.period}`,
    active: period === c.period,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Compute & models"]}
        title="Compute & models"
        subtitle="Inference and document-extraction spend, sourced from the case compute ledger."
      />

      <Filters chips={chips} right={`Period: ${period}`} />

      <KpiGrid cols={3}>
        <KpiCard
          label={`Total spend · ${period}`}
          value={formatCents(data.totals.totalCents)}
          dim={empty}
          sub={empty ? "Awaiting first build" : `${data.totals.entries} ledger entries`}
        />
        <KpiCard
          label="Avg cost / entry"
          value={
            data.totals.entries > 0
              ? formatCents(data.totals.totalCents / BigInt(data.totals.entries))
              : "—"
          }
          dim={empty}
          sub={empty ? "—" : "Across all model calls"}
        />
        <KpiCard
          label="Sonar status"
          value={health.status === "up" ? "Up" : health.status === "down" ? "Down" : "Unknown"}
          dim={health.status === "unknown"}
          sub={
            health.checkedAt
              ? `Checked ${new Date(health.checkedAt).toLocaleTimeString()}`
              : "No cron data yet"
          }
        />
      </KpiGrid>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title={`Top cases by spend · ${period}`}>
          {breakdown.topCases.length === 0 ? (
            <EmptyState
              title="No cases with compute spend in this window."
              subtitle="Once attorneys run builds, the top spenders will appear here."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {breakdown.topCases.map((row, idx) => (
                <li
                  key={row.caseId}
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
                      href={APP_ROUTES.case(row.caseId)}
                      className="mono underline-offset-2 hover:underline"
                    >
                      {row.caseId.slice(0, 8)}
                    </Link>
                    <Badge variant="neutral">{row.visaType}</Badge>
                  </span>
                  <span className="mono">
                    {formatCents(row.spentCents)} · {row.entries}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Top attorneys by compute spend · ${period}`}>
          {breakdown.byAttorney.length === 0 ? (
            <EmptyState
              title="No attorney has billable spend in this window."
              subtitle="Per-attorney aggregates show once builds run."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {breakdown.byAttorney.map((row, idx) => (
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
                    {formatCents(row.spentCents)} · {row.cases} cases
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title={`Cost by category · ${period}`}>
          <EmptyState
            title="Category breakdown awaits a schema migration."
            subtitle="The compute ledger doesn't yet split inference vs. embeddings vs. OCR vs. storage. Tracked under open_issues #18 — populated once Stage 07 attaches a `compute_category` to each entry."
          />
        </Card>
      </div>
    </>
  );
}
