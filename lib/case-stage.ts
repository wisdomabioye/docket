import type { CaseStatus } from "@/lib/case-status";
import { PIPELINE_STATUSES, type PipelineKey } from "@/lib/pipeline";
import { APP_ROUTES } from "@/config";

/**
 * Single source of truth for "what stage is this case in, and what
 * does the attorney do next?" Mapped from the 14-value
 * `caseStatusEnum` to the 5-bucket `PIPELINE_STATUSES` vocabulary plus
 * a human label, optional sub-line, the single next-action, and a
 * 0..100 progress percentage for visual bars.
 *
 * Replaces older mappers that drifted as the enum evolved:
 *   - `dashboard/page.tsx::stageFor` / `nextActionFor`
 *   - `me.ts::taskLabelFor` / `taskSubFor`
 *   - `CaseHeaderActions`' private `status -> {label, href}` map (Stage 13:
 *     consolidated here so the header CTA, the rail hint, the dashboard
 *     column, and the Stage-13 action card all read ONE table).
 *
 * Pure over `(status, approvals)` — no DB, no `server-only` — so the
 * dashboard server component, the `me.todayTasks` tRPC procedure, the
 * `CaseStageRail`, and the action surfaces can all share one derivation
 * with zero per-case query cost. Blocker detail (which needs DB) lives
 * in `server/services/cases/guidance.ts`, NOT here.
 */

export type CaseStageInput = {
  status: CaseStatus;
  /** Approval tally — only consulted when `status === "in_review"` to
   *  enrich the label with "X/Y approved". Optional everywhere else. */
  approvals?: { approved: number; total: number };
};

export type CaseStage = {
  /** Pipeline-bucket key. Same vocabulary as `lib/pipeline.ts`. */
  pipelineKey: PipelineKey;
  /** Short label — "Drafts ready", "In review · 2/5". */
  label: string;
  /** Secondary copy used by the today-tasks rail and the case-stage
   *  rail's hint line. Empty string for terminal / no-context states. */
  sub: string;
  /** The single next-action label, sourced from `PRIMARY_ACTION`.
   *  `undefined` for no-action states (extracting, building, filed,
   *  archived). */
  nextAction: string | undefined;
  /** Visual progress hint, 0..100. */
  progressPct: number;
};

/** Where the primary action routes. Used by the action card / header bar
 *  to pick an icon/affordance per destination without re-deriving it. */
export type CasePrimaryActionKind =
  | "intake"
  | "documents"
  | "build"
  | "review"
  | "package";

export type CasePrimaryAction = {
  label: string;
  href: string;
  kind: CasePrimaryActionKind;
};

/**
 * The canonical next-attorney-action per status — labels phrased to read
 * both as a rail hint ("Next: Build case") and a button ("Build case →").
 * `null` = no attorney action right now: either in-progress (extracting,
 * building — surface progress + auto-refresh instead) or terminal (filed,
 * archived). `Record<CaseStatus, …>` forces exhaustiveness, so adding an
 * enum value is a compile error until it's mapped here.
 */
const PRIMARY_ACTION: Record<
  CaseStatus,
  { label: string; kind: CasePrimaryActionKind; route: (id: string) => string } | null
> = {
  intake: {
    label: "Complete intake",
    kind: "intake",
    route: APP_ROUTES.caseIntake,
  },
  documents_pending: {
    label: "Upload evidence",
    kind: "documents",
    route: APP_ROUTES.caseDocuments,
  },
  extracting: null,
  ready_to_build: {
    label: "Build case",
    kind: "build",
    route: APP_ROUTES.caseBuild,
  },
  building: null,
  build_failed: {
    label: "Retry build",
    kind: "build",
    route: APP_ROUTES.caseBuild,
  },
  draft_ready: {
    label: "Review drafts",
    kind: "review",
    route: APP_ROUTES.caseOutputs,
  },
  in_review: {
    label: "Continue review",
    kind: "review",
    route: APP_ROUTES.caseOutputs,
  },
  needs_revision: {
    label: "Apply revisions",
    kind: "review",
    route: APP_ROUTES.caseOutputs,
  },
  approved: {
    label: "Download package",
    kind: "package",
    route: APP_ROUTES.casePackage,
  },
  package_ready: {
    label: "Download package",
    kind: "package",
    route: APP_ROUTES.casePackage,
  },
  delivered: {
    label: "Mark as filed",
    kind: "package",
    route: APP_ROUTES.casePackage,
  },
  filed: null,
  archived: null,
};

/** Statuses with async work in flight — no attorney action; the UI polls
 *  for updates and shows an indeterminate progress bar. The single source
 *  for "is this case mid-pipeline?", shared by the guidance service and
 *  the client action bar (client-safe — no `server-only`/DB here). */
export const IN_PROGRESS_STATUSES: ReadonlySet<CaseStatus> =
  new Set<CaseStatus>(["extracting", "building"]);

export function isInProgressStatus(status: CaseStatus): boolean {
  return IN_PROGRESS_STATUSES.has(status);
}

/**
 * The single next-attorney-action for a status, resolved to a concrete
 * href. Returns `null` for in-progress / terminal statuses. This is the
 * ONE source for the header CTA, the action card, and the dashboard
 * column — none of them should re-derive a status→action map.
 */
export function deriveCasePrimaryAction(
  status: CaseStatus,
  caseId: string,
): CasePrimaryAction | null {
  const entry = PRIMARY_ACTION[status];
  if (!entry) return null;
  return { label: entry.label, href: entry.route(caseId), kind: entry.kind };
}

const PIPELINE_BY_STATUS: Map<CaseStatus, PipelineKey> = (() => {
  const out = new Map<CaseStatus, PipelineKey>();
  for (const [key, statuses] of Object.entries(PIPELINE_STATUSES)) {
    for (const s of statuses) out.set(s, key as PipelineKey);
  }
  return out;
})();

/** Label / sub / progress per status. `nextAction` is layered on by
 *  `deriveCaseStage` from `PRIMARY_ACTION` so there is one source. */
function stageCopy(
  status: CaseStatus,
  approvals: CaseStageInput["approvals"],
  pipelineKey: PipelineKey,
): Omit<CaseStage, "nextAction"> {
  switch (status) {
    case "intake":
      return {
        pipelineKey,
        label: "Intake",
        sub: "Enter beneficiary information.",
        progressPct: 8,
      };
    case "documents_pending":
      return {
        pipelineKey,
        label: "Documents pending",
        sub: "Awaiting evidence uploads.",
        progressPct: 22,
      };
    case "extracting":
      return {
        pipelineKey,
        label: "Extracting documents",
        sub: "Reading uploaded files — usually under a minute.",
        progressPct: 32,
      };
    case "ready_to_build":
      return {
        pipelineKey,
        label: "Ready to build",
        sub: "Required documents collected.",
        progressPct: 42,
      };
    case "building":
      return {
        pipelineKey,
        label: "Building drafts",
        sub: "Drafting petition, personal statement, and exhibits.",
        progressPct: 55,
      };
    case "build_failed":
      return {
        pipelineKey,
        label: "Build failed",
        sub: "Pipeline error — see case for details.",
        progressPct: 50,
      };
    case "draft_ready":
      return {
        pipelineKey,
        label: "Drafts ready",
        sub: "Generated by Docket — awaiting your review.",
        progressPct: 65,
      };
    case "in_review": {
      const hasApprovals = approvals && approvals.total > 0;
      return {
        pipelineKey,
        label: hasApprovals
          ? `In review · ${approvals.approved}/${approvals.total}`
          : "In review",
        sub: hasApprovals
          ? `${approvals.approved} of ${approvals.total} outputs approved.`
          : "Reviewing generated outputs.",
        progressPct: 75,
      };
    }
    case "needs_revision":
      return {
        pipelineKey,
        label: "Needs revision",
        sub: "You marked outputs as needing changes.",
        progressPct: 70,
      };
    case "approved":
      return {
        pipelineKey,
        label: "Approved",
        sub: "All outputs approved — ready to package.",
        progressPct: 88,
      };
    case "package_ready":
      return {
        pipelineKey,
        label: "Package ready",
        sub: "Combined PDF compiled and ready to download.",
        progressPct: 92,
      };
    case "delivered":
      return {
        pipelineKey,
        label: "Delivered",
        sub: "Package downloaded — file with USCIS when ready.",
        progressPct: 96,
      };
    case "filed":
      return {
        pipelineKey,
        label: "Filed with USCIS",
        sub: "Receipt recorded. Awaiting adjudication.",
        progressPct: 100,
      };
    case "archived":
      return {
        pipelineKey,
        label: "Archived",
        sub: "Soft-deleted. Restore via admin tools.",
        progressPct: 100,
      };
  }
}

export function deriveCaseStage(input: CaseStageInput): CaseStage {
  const { status, approvals } = input;
  // `archived` is terminal and lives outside `PIPELINE_STATUSES` (it's
  // intentionally excluded — archived cases shouldn't bucket into any
  // active stage). Default to `filed` for the rail's last-step rendering.
  const pipelineKey: PipelineKey = PIPELINE_BY_STATUS.get(status) ?? "filed";
  return {
    ...stageCopy(status, approvals, pipelineKey),
    nextAction: PRIMARY_ACTION[status]?.label,
  };
}
