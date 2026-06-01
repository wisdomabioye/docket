import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { Card } from "@/components/ui";
import {
  CaseHeader,
  CaseHeaderActions,
  CaseNextAction,
  CaseSummaryCard,
  CriteriaCoverageCard,
} from "@/components/case";
import { RevenuePanel } from "@/components/revenue/RevenuePanel";
import { formatRelative } from "@/lib/utils";
import { describeCaseEvent } from "@/lib/case-event";
import { visaCriteriaConfig } from "@/lib/visa-criteria";
import { deriveCaseStage } from "@/lib/case-stage";
import { StoredBeneficiaryDataSchema } from "@/server/db/schema/zod/beneficiary";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Case ${id.slice(0, 8)}`) };
}

/**
 * Stage 11 case overview. Composes `CaseHeader` (eyebrow + title +
 * status badge + tabs) + a 2-column body: left column has Beneficiary
 * + Workflow detail cards + recent activity; right rail holds the
 * `RevenuePanel`.
 *
 * Lives inside the workspace shell (`app/(app)/(workspace)/layout.tsx`),
 * so this page only renders the inner content — no second `<main>`.
 */
export default async function CaseDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const [data, coverage, approvalsMap] = await Promise.all([
    api.case.get({ caseId: id }),
    api.case.criteriaCoverage({ caseId: id }),
    // Per-case approval tally — feeds the stage rail's "in review · X/Y"
    // label without an extra round-trip. Empty object if no outputs yet.
    api.output.summarize({ caseIds: [id] }),
  ]);
  if (!data) notFound();
  // Fetched AFTER the notFound guard so a non-participant's NOT_FOUND from
  // these doesn't mask the clean 404 above. Parallel — independent reads.
  const [guidance, storage, recommenders] = await Promise.all([
    api.case.guidance({ caseId: id }),
    api.case.storageUsage({ caseId: id }),
    api.recommender.list({ caseId: id }),
  ]);
  const approvals = approvalsMap[id];
  const stage = deriveCaseStage({
    status: data.status,
    ...(approvals ? { approvals } : {}),
  });

  // Read-tolerant parse (handles legacy keys — see open_issues #69) for
  // typed access to the beneficiary fields the summary card needs.
  const parsedBeneficiary = StoredBeneficiaryDataSchema.safeParse(
    data.beneficiaryData ?? {},
  );
  const beneficiary = parsedBeneficiary.success ? parsedBeneficiary.data : {};
  const meta = beneficiary.nationality;
  const residence =
    [beneficiary.currentCity, beneficiary.currentCountry]
      .filter(Boolean)
      .join(", ") || undefined;
  const config = visaCriteriaConfig(data.visaType);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={data.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={data.visaType}
        {...(meta ? { meta } : {})}
        status={data.status}
        stage={stage}
        current="overview"
        actions={<CaseHeaderActions caseId={data.id} status={data.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-6">
          <CriteriaCoverageCard
            visaType={data.visaType}
            visaSupported={coverage.visaSupported}
            rows={coverage.rows}
            metCount={coverage.metCount}
            minRequired={config?.minCriteriaMet ?? 0}
          />

          <Card title="Recent activity">
            {data.events.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--ink-muted)" }}
              >
                No events yet.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.events.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0"
                    style={{
                      borderColor: "var(--border, rgba(0,0,0,0.06))",
                    }}
                  >
                    <span className="text-xs" style={{ color: "var(--ink)" }}>
                      {describeCaseEvent(e.eventType, e.actorType, e.details)}
                    </span>
                    <span
                      className="mono shrink-0 text-[11px]"
                      style={{ color: "var(--ink-muted)" }}
                      suppressHydrationWarning
                    >
                      {formatRelative(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <CaseSummaryCard
            visaType={data.visaType}
            {...(beneficiary.field ? { field: beneficiary.field } : {})}
            {...(beneficiary.nationality
              ? { nationality: beneficiary.nationality }
              : {})}
            {...(residence ? { residence } : {})}
            {...(beneficiary.targetFilingDate
              ? { targetFilingDate: beneficiary.targetFilingDate }
              : {})}
            recommenderCount={recommenders.length}
            documentCount={storage.documentCount}
            usedBytes={storage.usedBytes}
            outputsApproved={approvals?.approved ?? 0}
            outputsTotal={approvals?.total ?? 0}
          />
          <CaseNextAction guidance={guidance} variant="card" />
          <RevenuePanel
            caseId={data.id}
            initial={{
              feeCents: Number(data.caseFeeCents ?? 0n),
              docketShareCents: Number(data.docketShareCents ?? 0n),
              attorneyShareCents: Number(data.attorneyShareCents ?? 0n),
              revenueStatus: data.revenueStatus,
            }}
          />
        </aside>
      </div>
    </div>
  );
}

