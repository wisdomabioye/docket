import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { AuditRow } from "@/components/admin/AuditRow";
import { KpiCard, KpiGrid } from "@/components/kpi";
import { Card, EmptyState } from "@/components/ui";
import { formatCents } from "@/lib/utils";
import Link from "next/link";

export const metadata = { title: pageTitle("Admin overview") };

/**
 * `/admin` overview. Single tRPC round-trip via `getOverviewMetrics` —
 * one query that batches attorney counts, case status totals, last-7d
 * revenue rollup, and the 10 most recent audit events. Auth happens in
 * the layout (cheap admin probe), so this page just renders.
 *
 * Empty-state friendly: revenue starts at $0 / 0 filings until Stage 10
 * wires `case_fee_cents` writes; the page renders the same KpiCards but
 * the EmptyState `Card` below explains why the totals look quiet.
 */
export default async function AdminOverviewPage(): Promise<React.ReactElement> {
  const data = await api.admin.getOverviewMetrics();

  const noRevenueYet = data.revenue7d.filings === 0;
  const noEventsYet = data.recentEvents.length === 0;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin"]}
        title="Platform overview"
        subtitle={`${data.attorneys.active} active attorneys · ${data.attorneys.pending} pending · ${data.cases.total.toLocaleString()} total cases`}
      />

      <KpiGrid>
        <KpiCard
          label="Gross revenue · 7d"
          value={formatCents(data.revenue7d.grossCents)}
          dim={noRevenueYet}
          sub={
            noRevenueYet
              ? "Awaiting first filing"
              : `${data.revenue7d.filings} filings`
          }
        />
        <KpiCard
          label="Docket share · 7d"
          value={formatCents(data.revenue7d.docketShareCents)}
          dim={noRevenueYet}
          sub={noRevenueYet ? "—" : "15% of gross"}
        />
        <KpiCard
          label="Active attorneys"
          value={data.attorneys.active.toLocaleString()}
          sub={
            data.attorneys.pending > 0
              ? `${data.attorneys.pending} awaiting activation`
              : "All current"
          }
        />
        <KpiCard
          label="Cases in flight"
          value={(
            data.cases.total -
            (data.cases.byStatus.filed ?? 0) -
            (data.cases.byStatus.archived ?? 0)
          ).toLocaleString()}
          sub={`${(data.cases.byStatus.filed ?? 0).toLocaleString()} filed lifetime`}
        />
      </KpiGrid>

      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card
          title="Ops inbox"
          meta={
            <Link
              href={APP_ROUTES.adminAuditLog}
              className="underline hover:text-[var(--ink)]"
            >
              View audit log →
            </Link>
          }
          flush
        >
          {noEventsYet ? (
            <div className="p-4">
              <EmptyState
                title="No events yet."
                subtitle="Activity from attorneys and admins will appear here."
              />
            </div>
          ) : (
            <ul>
              {data.recentEvents.map((e) => (
                <AuditRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Attorney pipeline">
            <dl className="space-y-2 text-sm">
              <PipelineRow label="Active" value={data.attorneys.active} />
              <PipelineRow
                label="Pending"
                value={data.attorneys.pending}
                href={APP_ROUTES.adminAttorneys}
                {...(data.attorneys.pending > 0
                  ? { tone: "warning" as const }
                  : {})}
              />
              <PipelineRow
                label="Suspended"
                value={data.attorneys.suspended}
                {...(data.attorneys.suspended > 0
                  ? { tone: "error" as const }
                  : {})}
              />
              <PipelineRow label="Inactive" value={data.attorneys.inactive} />
            </dl>
          </Card>

          <Card title="Case stages">
            <dl className="space-y-1.5 text-sm">
              {(
                [
                  ["Intake", "intake"],
                  ["Documents", "documents_pending"],
                  ["Drafting", "building"],
                  ["Review", "in_review"],
                  ["Filed", "filed"],
                ] as const
              ).map(([label, key]) => (
                <PipelineRow
                  key={key}
                  label={label}
                  value={data.cases.byStatus[key] ?? 0}
                />
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function PipelineRow(props: {
  label: string;
  value: number;
  href?: string;
  tone?: "warning" | "error";
}) {
  const valueColor =
    props.tone === "warning"
      ? "var(--warning)"
      : props.tone === "error"
        ? "var(--error)"
        : "var(--ink)";
  const inner = (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--ink-muted)]">{props.label}</dt>
      <dd className="mono font-medium" style={{ color: valueColor }}>
        {props.value.toLocaleString()}
      </dd>
    </div>
  );
  return props.href ? (
    <Link
      href={props.href}
      className="block rounded-sm hover:bg-[var(--surface-sunken)]"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}
