import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { Card, EmptyState } from "@/components/ui";
import { CaseHeader } from "@/components/case";
import { RequestBuildButton } from "./RequestBuildButton";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Build · Case ${id.slice(0, 4)}`) };
}

/**
 * Stage 7 + Stage 11 build page. Reached via the case-overview header's
 * "Build →" CTA when status is `ready_to_build` / `build_failed`. NOT
 * a tab in `CaseHeader` — the mockup keeps build separate from the
 * five primary case tabs.
 *
 * Composition:
 *   - CaseHeader (no active tab — overrides the underline)
 *   - Readiness checklist card listing each gate from `case.readiness`
 *   - Outputs preview list (the 5 things Docket will draft per case)
 *   - Confirm bar with the `RequestBuildButton`
 *
 * The button is server-disabled when `readiness.ok === false`. The
 * mutation re-runs the same predicate server-side — race-safe.
 */
export default async function CaseBuildPage({
  params,
}: Props): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const readiness = await api.case.readiness({ caseId: id });

  const beneficiary =
    (caseRow.beneficiaryData as {
      fullName?: string;
      nationality?: string;
    } | null) ?? {};
  const meta = beneficiary.nationality ? beneficiary.nationality : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CaseHeader
        caseId={caseRow.id}
        beneficiaryName={beneficiary.fullName ?? "Unnamed beneficiary"}
        visaType={caseRow.visaType}
        {...(meta ? { meta } : {})}
        status={caseRow.status}
        // No active tab — `Build` isn't in the tab list. The header
        // still renders the row so the user can navigate sideways.
        current="overview"
      />

      <header>
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          Build drafts
        </p>
        <h2
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          {readiness.ok ? "Ready to draft." : "Almost ready."}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
          Docket will produce five filing-ready outputs in parallel — typically{" "}
          <b style={{ color: "var(--ink)" }}>10–20 minutes</b> end-to-end. You
          stay attorney of record; nothing leaves the workspace.
        </p>
      </header>

      <Card title="Readiness check">
        <ReadinessGate
          label="Case status accepts a build"
          ok={readiness.statusOk}
          detail={
            readiness.statusOk
              ? `Status is ${readiness.status} — accepts build.`
              : `Status is ${readiness.status} — must be ready_to_build or build_failed.`
          }
        />
        {readiness.reasons.length === 0 ? (
          <ReadinessGate
            label="Content gates"
            ok
            detail="Intake complete and at least one extracted document on file."
          />
        ) : (
          readiness.reasons.map((r, idx) => (
            <ReadinessGate key={idx} label={r} ok={false} />
          ))
        )}
      </Card>

      <Card title="What Docket will produce">
        <ul className="space-y-3 text-sm">
          {OUTPUT_PREVIEW.map((out, idx) => (
            <li
              key={out.title}
              className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-3 border-b py-2 last:border-0"
              style={{ borderColor: "var(--border, rgba(0,0,0,0.06))" }}
            >
              <span
                className="mono text-[10px] uppercase tracking-wider"
                style={{ color: "var(--ink-muted)" }}
              >
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="font-medium">{out.title}</p>
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {out.body}
                </p>
              </div>
              <span
                className="mono text-[10px] uppercase tracking-wider"
                style={{ color: "var(--ink-muted)" }}
              >
                {out.pages}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Generate" flush>
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm" style={{ color: "var(--ink-soft)" }}>
            {readiness.ok ? (
              <>
                Pipeline runs in the background — you can leave this page.
                We&rsquo;ll surface progress on the Outputs tab as each draft
                lands.
              </>
            ) : (
              <>
                Resolve the gaps above before generating.{" "}
                <span style={{ color: "var(--ink-muted)" }}>
                  The button stays disabled until every check is green.
                </span>
              </>
            )}
          </div>
          <RequestBuildButton caseId={caseRow.id} disabled={!readiness.ok} />
        </div>
      </Card>

      {!readiness.ok && readiness.reasons.length > 0 ? (
        <EmptyState
          title="Need to revisit intake or documents?"
          subtitle="Use the tabs above — Intake and Documents stay editable until the build runs."
        />
      ) : null}
    </div>
  );
}

function ReadinessGate(props: {
  label: string;
  ok: boolean;
  detail?: string;
}): React.ReactElement {
  return (
    <div
      className="flex items-baseline gap-3 border-b py-2 last:border-0"
      style={{ borderColor: "var(--border, rgba(0,0,0,0.06))" }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          background: props.ok
            ? "var(--success, #1f6b3d)"
            : "var(--warning, #b1830e)",
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{props.label}</p>
        {props.detail ? (
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            {props.detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const OUTPUT_PREVIEW: ReadonlyArray<{
  title: string;
  body: string;
  pages: string;
}> = [
  {
    title: "Evidence plan",
    body: "Criterion-by-criterion mapping of exhibits with strength + gap analysis. Built first; downstream prompts depend on it.",
    pages: "3–6 pp",
  },
  {
    title: "Personal statement",
    body: "First-person narrative in the beneficiary's voice, anchored to specific exhibits.",
    pages: "10–15 pp",
  },
  {
    title: "Petition letter",
    body: "Legal brief addressed to USCIS. Each criterion argued with evidence citations.",
    pages: "15–25 pp",
  },
  {
    title: "Exhibit index",
    body: "Numbered, tabbed exhibit list cross-referenced to every claim in the petition letter.",
    pages: "4–8 pp",
  },
  {
    title: "Recommendation templates",
    body: "One tailored draft per recommender — emailable, with redline instructions.",
    pages: "2–3 pp ea.",
  },
];
