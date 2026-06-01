import { PIPELINE_KEYS, type PipelineKey } from "@/lib/pipeline";
import type { CaseStage } from "@/lib/case-stage";

/**
 * Horizontal 5-step progress rail rendered inside `CaseHeader` on
 * every case/[id]/* page. Mirrors the dashboard sidebar's pipeline
 * vocabulary (`PIPELINE_KEYS`): intake → documents → drafting →
 * review → filed. The active step is bold-inked, completed steps are
 * inked, future steps are muted. The sub-line surfaces the stage's `sub`
 * copy only — the next-action CTA moved to the adjacent `CaseActionBar`
 * (Stage 13) so there's a single actionable surface.
 *
 * Pure presentational — derives nothing. The page server-component
 * computes `deriveCaseStage(...)` (with approvals data if available)
 * and passes the result in.
 */

export type CaseStageRailProps = {
  stage: CaseStage;
};

const STEP_LABELS: Record<PipelineKey, string> = {
  intake: "Intake",
  documents: "Documents",
  drafting: "Drafting",
  review: "Review",
  filed: "Filed",
};

export function CaseStageRail(props: CaseStageRailProps): React.ReactElement {
  const activeIdx = PIPELINE_KEYS.indexOf(props.stage.pipelineKey);
  return (
    <div className="mt-4 space-y-2" data-component="case-stage-rail">
      <ol
        aria-label="Case progress"
        className="flex items-center gap-2 text-[11px]"
      >
        {PIPELINE_KEYS.map((key, idx) => {
          const state: StepState =
            idx < activeIdx
              ? "complete"
              : idx === activeIdx
                ? "active"
                : "upcoming";
          return (
            <li
              key={key}
              className="flex flex-1 items-center gap-2"
              {...(state === "active"
                ? { "aria-current": "step" as const }
                : {})}
            >
              <span
                className="mono inline-block h-1.5 flex-1 rounded-sm"
                style={{ background: barColor(state) }}
              />
              <span
                className="mono whitespace-nowrap uppercase tracking-wider"
                style={{
                  color: state === "upcoming"
                    ? "var(--ink-muted)"
                    : "var(--ink)",
                  fontWeight: state === "active" ? 600 : 400,
                  opacity: state === "upcoming" ? 0.5 : 1,
                }}
              >
                {STEP_LABELS[key]}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Sub-copy only. The next-action CTA lives in the adjacent
       *  `CaseActionBar` (Stage 13) so there's one actionable surface. */}
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        {props.stage.sub}
      </p>
    </div>
  );
}

type StepState = "complete" | "active" | "upcoming";

function barColor(state: StepState): string {
  switch (state) {
    case "complete":
      return "var(--ink)";
    case "active":
      return "var(--ink)";
    case "upcoming":
      return "var(--border, rgba(0,0,0,0.15))";
  }
}
