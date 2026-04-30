import { KpiCard, KpiGrid } from "@/components/kpi";
import { formatCents } from "@/lib/utils";

/**
 * Stage 11 dashboard 4-up KPI strip. Composes the existing `KpiGrid` +
 * `KpiCard` primitives — no new chrome, just per-card formatting +
 * fall-through copy when a metric is zero.
 *
 * Mockup: dashboard.html `.kpi-grid` (l. 213–252). Four metrics:
 * Active cases, Drafts awaiting review, Filed this quarter, Revenue MTD.
 *
 * Delta badges (▲/▼) are intentionally omitted from this Phase 1
 * version — we don't store a previous-period snapshot to compare
 * against. Stage 12 polish can add a delta row once the comparison
 * snapshot lands.
 */
export type KpiStripDashboardProps = {
  activeCases: number;
  draftsAwaitingReview: number;
  filedThisQuarter: number;
  revenueMtdCents: bigint;
};

export function KpiStripDashboard(
  props: KpiStripDashboardProps,
): React.ReactElement {
  return (
    <KpiGrid cols={4}>
      <KpiCard
        label="Active cases"
        value={props.activeCases.toString()}
        dim={props.activeCases === 0}
        sub={props.activeCases === 0 ? "No cases yet" : "Across all stages"}
      />
      <KpiCard
        label="Drafts awaiting review"
        value={props.draftsAwaitingReview.toString()}
        dim={props.draftsAwaitingReview === 0}
        sub={
          props.draftsAwaitingReview === 0
            ? "Nothing pending"
            : "Generated, awaiting your review"
        }
      />
      <KpiCard
        label="Filed this quarter"
        value={props.filedThisQuarter.toString()}
        dim={props.filedThisQuarter === 0}
        sub={
          props.filedThisQuarter === 0
            ? "No filings yet"
            : "USCIS submissions"
        }
      />
      <KpiCard
        label="Revenue MTD"
        value={formatCents(props.revenueMtdCents)}
        dim={props.revenueMtdCents === 0n}
        sub={
          props.revenueMtdCents === 0n
            ? "Awaiting first filing"
            : "Docket share, current month"
        }
      />
    </KpiGrid>
  );
}
