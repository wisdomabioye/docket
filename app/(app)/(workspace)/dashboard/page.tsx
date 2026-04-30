import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { getMe } from "@/lib/me-cache";
import {
  PIPELINE_STATUSES,
  parsePipelineKey,
  type PipelineKey,
} from "@/lib/pipeline";
import { PendingApprovalCard } from "@/components/onboarding";
import { RevenueCard } from "@/components/revenue/RevenueCard";
import {
  ActivityFeed,
  CaselineList,
  GreetingBand,
  KpiStripDashboard,
  TodayCard,
  type CaselineProps,
  type ActivityItem,
  type TodayItem,
} from "@/components/dashboard";

export const metadata = { title: pageTitle("Dashboard") };

/**
 * Stage 11 attorney dashboard. Mockup: `dashboard.html`.
 *
 * Composition:
 *   - GreetingBand (greeting + contextual stats + + New case CTA)
 *   - KpiStripDashboard (Active / Drafts / Filed / Revenue MTD)
 *   - Two-column body: caseline list (main) + Today / Activity / Revenue (rail)
 *
 * Pending-status attorneys see the `PendingApprovalCard` inside the
 * workspace shell so the sidebar context is visible (per Stage 03 DoD).
 *
 * Status routing happens in the workspace layout; we just branch on
 * `status === 'pending'` here for the inline card vs. data view.
 */
type DashboardSearchParams = { stage?: string };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<DashboardSearchParams>;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await getMe();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");

  if (!me.attorneyProfile) redirect(APP_ROUTES.onboarding);
  const status = me.attorneyProfile.status;

  if (status === "pending") {
    return (
      <div className="space-y-6">
        <GreetingBand name={me.user.name ?? me.user.email} />
        <PendingApprovalCard
          email={me.user.email}
          submittedAt={me.attorneyProfile.submittedAt}
        />
      </div>
    );
  }

  if (status !== "active") redirect(APP_ROUTES.onboarding);

  // Read sidebar stage filter from the URL. Unknown / missing → "All
  // stages" (no filter). The case-router input validator rejects a
  // truncated/typo'd `stage` value, so we narrow before the call.
  const params = (await searchParams) ?? {};
  const stage: PipelineKey | null = parsePipelineKey(params.stage);
  const statusFilter = stage ? PIPELINE_STATUSES[stage] : undefined;

  const [casesPage, kpis, today, activity] = await Promise.all([
    api.case.list(statusFilter ? { status: [...statusFilter] } : {}),
    api.me.dashboardKpis(),
    api.me.todayTasks(),
    api.me.activityFeed(),
  ]);

  const approvals =
    casesPage.items.length === 0
      ? ({} as Record<string, { approved: number; total: number }>)
      : await api.output.summarize({
          caseIds: casesPage.items.map((c) => c.id),
        });

  const caselineItems: ReadonlyArray<CaselineProps> = casesPage.items.map(
    (c) => buildCaseline(c, approvals),
  );

  const greetingStats = buildGreetingStats(kpis);

  const todayItems: ReadonlyArray<TodayItem> = today.map((t) => ({
    id: t.id,
    label: t.label,
    sub: t.sub,
    overdue: t.overdue,
  }));

  const activityItems: ReadonlyArray<ActivityItem> = activity.map((a) => ({
    id: a.id,
    caseId: a.caseId,
    actorType: a.actorType,
    eventType: a.eventType,
    beneficiary: a.beneficiary,
    createdAt: a.createdAt,
  }));

  return (
    <div className="space-y-6">
      <GreetingBand
        name={me.user.name ?? me.user.email}
        stats={greetingStats}
        actions={
          <Link
            href={APP_ROUTES.newCase}
            className="rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3.5 py-1.5 text-xs font-medium text-[var(--cream)]"
          >
            + New case
          </Link>
        }
      />

      <KpiStripDashboard
        activeCases={kpis.activeCases}
        draftsAwaitingReview={kpis.draftsAwaitingReview}
        filedThisQuarter={kpis.filedThisQuarter}
        revenueMtdCents={kpis.revenueMtdCents}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section
          className="rounded-md border bg-[var(--surface,white)] p-3"
          style={{ borderColor: "var(--border, rgba(0,0,0,0.08))" }}
        >
          <header className="flex flex-col gap-2 px-3 pb-3 sm:flex-row sm:items-baseline sm:justify-between">
            <div className="flex items-baseline gap-3">
              <h2
                className="text-sm font-medium"
                style={{ color: "var(--ink)" }}
              >
                Cases
              </h2>
              {stage ? (
                <Link
                  href={APP_ROUTES.dashboard}
                  className="rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                  style={{
                    background: "var(--accent-soft, var(--surface-sunken))",
                    color: "var(--accent, var(--ink))",
                  }}
                >
                  {pipelineLabel(stage)} · clear ✕
                </Link>
              ) : null}
            </div>
            <span
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "var(--ink-muted)" }}
            >
              {casesPage.items.length} shown
            </span>
          </header>
          <CaselineList
            items={caselineItems}
            emptyState={
              <p
                className="rounded-md border border-dashed p-6 text-center text-sm"
                style={{
                  borderColor: "var(--border, rgba(0,0,0,0.12))",
                  color: "var(--ink-muted)",
                }}
              >
                No cases yet.{" "}
                <Link
                  href={APP_ROUTES.newCase}
                  className="underline-offset-2 hover:underline"
                  style={{ color: "var(--ink)" }}
                >
                  Open your first case
                </Link>
                .
              </p>
            }
          />
        </section>

        <aside className="space-y-6">
          <TodayCard items={todayItems} />
          <ActivityFeed items={activityItems} />
          <RevenueCard />
        </aside>
      </div>
    </div>
  );
}

function buildGreetingStats(kpis: {
  draftsAwaitingReview: number;
  activeCases: number;
}): GreetingStats {
  const stats: Array<{ label: string; tone?: "neutral" | "alert" }> = [];
  if (kpis.draftsAwaitingReview > 0) {
    stats.push({
      label: `${kpis.draftsAwaitingReview} draft${kpis.draftsAwaitingReview === 1 ? "" : "s"} awaiting review`,
    });
  }
  if (kpis.activeCases > 0 && stats.length === 0) {
    stats.push({
      label: `${kpis.activeCases} active case${kpis.activeCases === 1 ? "" : "s"}`,
    });
  }
  return stats;
}

type GreetingStats = ReadonlyArray<{
  label: string;
  tone?: "neutral" | "alert";
}>;

type CaseListItem = Awaited<
  ReturnType<typeof api.case.list>
>["items"][number];

function buildCaseline(
  c: CaseListItem,
  approvals: Record<string, { approved: number; total: number }>,
): CaselineProps {
  const beneficiary =
    (c.beneficiaryData as { fullName?: string } | null) ?? {};
  const stage = stageFor(c.status, approvals[c.id]);
  const nextAction = nextActionFor(c.status);
  return {
    caseId: c.id,
    beneficiaryName: beneficiary.fullName ?? "Unnamed beneficiary",
    visaType: c.visaType,
    stageLabel: stage.label,
    stagePercent: stage.percent,
    updatedLabel: new Date(c.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    ...(nextAction !== undefined ? { nextAction } : {}),
  };
}

function stageFor(
  status: string,
  approvals?: { approved: number; total: number },
): { label: string; percent: number } {
  switch (status) {
    case "intake":
      return { label: "Intake", percent: 8 };
    case "documents_pending":
      return { label: "Documents pending", percent: 22 };
    case "extracting":
      return { label: "Extracting documents", percent: 32 };
    case "ready_to_build":
      return { label: "Ready to build", percent: 42 };
    case "building":
      return { label: "Building drafts", percent: 55 };
    case "build_failed":
      return { label: "Build failed", percent: 50 };
    case "draft_ready":
      return { label: "Drafts ready", percent: 65 };
    case "in_review":
      return {
        label:
          approvals && approvals.total > 0
            ? `In review · ${approvals.approved}/${approvals.total}`
            : "In review",
        percent: 75,
      };
    case "needs_revision":
      return { label: "Needs revision", percent: 70 };
    case "approved":
      return { label: "Approved", percent: 88 };
    case "package_ready":
      return { label: "Package ready", percent: 92 };
    case "delivered":
      return { label: "Delivered", percent: 96 };
    case "filed":
      return { label: "Filed with USCIS", percent: 100 };
    case "archived":
      return { label: "Archived", percent: 100 };
    default:
      return { label: status, percent: 0 };
  }
}

/** Human label for the active pipeline filter chip. Matches the
 *  `AttorneySidebar` labels so the chip wording reads exactly like
 *  the sidebar item the user clicked. */
function pipelineLabel(key: PipelineKey): string {
  const labels: Record<PipelineKey, string> = {
    intake: "Intake",
    documents: "Documents",
    drafting: "Drafting",
    review: "Review",
    filed: "Filed",
  };
  return labels[key];
}

function nextActionFor(status: string): string | undefined {
  switch (status) {
    case "intake":
      return "Complete intake form";
    case "documents_pending":
      return "Upload evidence";
    case "ready_to_build":
      return "Click Build";
    case "build_failed":
      return "Retry build";
    case "draft_ready":
      return "Review drafts";
    case "needs_revision":
      return "Apply revisions";
    case "approved":
      return "Generate package";
    case "package_ready":
      return "Download package";
    case "delivered":
      return "Mark filed";
    default:
      return undefined;
  }
}
