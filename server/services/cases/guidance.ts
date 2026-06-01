import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cases } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import { APP_ROUTES } from "@/config";
import {
  type CaseStage,
  deriveCasePrimaryAction,
  deriveCaseStage,
  IN_PROGRESS_STATUSES,
} from "@/lib/case-stage";
import type { CaseStatus } from "@/lib/case-status";
import {
  type BlockerResolve,
  type GateBlocker,
  meetsBuildRequirements,
  meetsIntakeRequirements,
} from "@/server/services/cases/readiness";
import { computePreflight } from "@/server/services/cases/preflight";
import { summarizeOutputApprovals } from "@/server/services/output";

/**
 * The single "what should the attorney do next, and what's blocking it?"
 * resolver. Composes the existing gate functions (`meetsIntakeRequirements`,
 * `meetsBuildRequirements`, `computePreflight`) — it does NOT introduce a
 * second source of truth for those gates, and it never fabricates a
 * blocker for a stage that has none.
 *
 * Two layers, deliberately split (Stage 13):
 *   - PURE `deriveCasePrimaryAction` / `deriveCaseStage` (lib/case-stage) —
 *     used by lists / the dashboard with zero per-case DB cost.
 *   - This RICH service — single-case only — adds the DB-backed blocker
 *     detail. Never call it per-row in a list (N+1).
 *
 * Gathering is STAGE-CONDITIONAL: only the gate relevant to the current
 * status is queried (no preflight on an intake case, etc.).
 */

export type GuidanceBlocker = {
  /** Human-readable reason. */
  label: string;
  /** Where to go to fix it; `null` = wait-only (nothing to do but wait,
   *  e.g. extraction still running). */
  resolveHref: string | null;
};

export type CaseGuidance = {
  stage: CaseStage;
  /**
   * The single next action. `null` for in-progress (extracting/building)
   * and terminal (filed/archived) statuses — surface progress instead.
   * When blocked-but-actionable this is RETARGETED to the top blocker's
   * fix action (label + href), enabled. When only wait-only blockers
   * remain, the status's own action shows disabled.
   */
  primary: { label: string; href: string; enabled: boolean } | null;
  blockers: GuidanceBlocker[];
  progress: { pct: number; indeterminate: boolean };
  /** Phase-2 seam: which actor this guidance is for. Always "attorney" in
   *  Phase 1; lets Phase 2 add an applicant view without reshaping. */
  audience: "attorney";
};

const RESOLVE_ROUTE: Record<
  Exclude<BlockerResolve, null>,
  (caseId: string) => string
> = {
  intake: APP_ROUTES.caseIntake,
  documents: APP_ROUTES.caseDocuments,
  review: APP_ROUTES.caseOutputs,
};

/** Maps a failing non-advisory pre-flight gate (from `computePreflight`)
 *  to a resolve kind. Gates the attorney can act on by approving outputs
 *  route to "review"; structural gates (criteria threshold, bar standing)
 *  aren't fixable by a single action here → null (informational; the
 *  package page's PreflightCard shows the specifics). Gate IDs mirror
 *  `preflight.ts`; a NEW gate defaults to informational (null) rather
 *  than guessing a fix route — safe, never misleading. */
function preflightResolve(gateId: string): BlockerResolve {
  switch (gateId) {
    case "outputs_approved":
    case "recommender_letters":
      return "review";
    case "criteria_threshold":
    case "attorney_bar_active":
    case "signed_letters_uploaded":
      return null;
    default:
      return null;
  }
}

type GatherResult = { status: CaseStatus; blockers: GateBlocker[] };

/** Stage-conditional blocker gather. Reuses the shared gate functions;
 *  returns the case status alongside so the caller derives stage once. */
async function gatherGate(db: Db, caseId: string): Promise<GatherResult> {
  const [row] = await db
    .select({ status: cases.status })
    .from(cases)
    .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", `case ${caseId} not found`);
  const status = row.status;

  switch (status) {
    case "intake": {
      const r = await meetsIntakeRequirements({ db, caseId });
      return { status, blockers: r.blockers };
    }
    case "documents_pending":
    case "ready_to_build":
    case "build_failed": {
      const r = await meetsBuildRequirements({ db, caseId });
      return { status, blockers: r.blockers };
    }
    case "approved":
    case "package_ready": {
      const pf = await computePreflight({ db, caseId });
      const blockers: GateBlocker[] = pf.gates
        .filter((g) => !g.advisory && !g.ok)
        .map((g) => {
          const resolve = preflightResolve(g.id);
          return {
            message: `${g.label}: ${g.detail}`,
            resolve,
            action: resolve === "review" ? "Review drafts" : null,
          };
        });
      return { status, blockers };
    }
    // extracting / building (in progress), draft_ready / in_review /
    // needs_revision / delivered (the action IS the next step, no gate),
    // filed / archived (terminal) — no gathered blockers.
    default:
      return { status, blockers: [] };
  }
}

/** Resolve the primary CTA, applying the blocked→fix-action rule. */
function resolvePrimary(
  status: CaseStatus,
  caseId: string,
  blockers: GateBlocker[],
): CaseGuidance["primary"] {
  const base = deriveCasePrimaryAction(status, caseId);
  if (!base) return null; // in-progress / terminal — no action
  if (blockers.length === 0) {
    return { label: base.label, href: base.href, enabled: true };
  }
  // Blocked: the first actionable blocker BECOMES the primary (a fix
  // action). Wait-only blockers (resolve/action null) don't retarget.
  for (const b of blockers) {
    if (b.resolve !== null && b.action !== null) {
      return {
        label: b.action,
        href: RESOLVE_ROUTE[b.resolve](caseId),
        enabled: true,
      };
    }
  }
  // Only wait-only blockers remain: show the status action, disabled.
  return { label: base.label, href: base.href, enabled: false };
}

export async function getCaseGuidance(args: {
  /** RLS-engaged tx so an unauthorized caller sees NOT_FOUND, not a
   *  content-leak via the blocker text. */
  db: Db;
  caseId: string;
}): Promise<CaseGuidance> {
  const { db, caseId } = args;
  const gate = await gatherGate(db, caseId);
  const { status } = gate;

  // `in_review` label enrichment needs the real approval tally.
  let approvals: { approved: number; total: number } | undefined;
  if (status === "in_review") {
    const tally = await summarizeOutputApprovals({ db, caseIds: [caseId] });
    approvals = tally.get(caseId) ?? { approved: 0, total: 0 };
  }

  const stage = deriveCaseStage(
    approvals ? { status, approvals } : { status },
  );
  const blockers: GuidanceBlocker[] = gate.blockers.map((b) => ({
    label: b.message,
    resolveHref: b.resolve ? RESOLVE_ROUTE[b.resolve](caseId) : null,
  }));

  return {
    stage,
    primary: resolvePrimary(status, caseId, gate.blockers),
    blockers,
    progress: {
      pct: stage.progressPct,
      indeterminate: IN_PROGRESS_STATUSES.has(status),
    },
    audience: "attorney",
  };
}
