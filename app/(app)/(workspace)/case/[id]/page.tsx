import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { Card } from "@/components/ui";
import {
  CaseHeader,
  CaseHeaderActions,
  CriteriaCoverageCard,
} from "@/components/case";
import { RevenuePanel } from "@/components/revenue/RevenuePanel";
import { formatRelative } from "@/lib/utils";
import { visaCriteriaConfig } from "@/lib/visa-criteria";
import { deriveCaseStage } from "@/lib/case-stage";

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
  const approvals = approvalsMap[id];
  const stage = deriveCaseStage({
    status: data.status,
    ...(approvals ? { approvals } : {}),
  });

  const beneficiary =
    (data.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};

  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;
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
                    <span className="mono text-xs">{e.eventType}</span>
                    <span
                      className="text-xs"
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

