/**
 * Case status state machine.
 *
 * `caseStatusEnum` (14 values) is the column type. This file is the
 * source of truth for which transitions are *legal*. The service layer
 * (`server/services/cases/transition.ts`) enforces it on every status
 * write — Postgres can't.
 *
 * Two writers cover the full lifecycle:
 *   - Pre-build edges: `server/services/cases/readiness.ts` reconciler
 *     drives `documents_pending → extracting → ready_to_build`.
 *   - Post-build edges: `server/services/cases/reconcile-status.ts`
 *     reconciler (ADR-006) drives `draft_ready → in_review → approved
 *     → delivered → filed` plus the admin reverse `filed → delivered`.
 *
 * `case.requestBuild` and the build job own `building` / `build_failed`
 * / `draft_ready` directly. `case.archive` writes `* → archived`
 * directly — archive is a terminal flag, not lifecycle progress.
 *
 * Terminal states (no outgoing edges): `archived` only. `filed →
 * delivered` is the admin reverse path (ADR-006); `filed → archived` is
 * the soft-delete path.
 *
 * Illegal transitions throw `AppError("CONFLICT", ...)` from the
 * transition service. Status-gated mutations use `assertOutputMutationAllowed`
 * (below) to reject with the same code at procedure entry, before any
 * write commits.
 */

import { AppError } from "@/lib/errors";
import type { caseStatusEnum, documentTypeEnum } from "@/server/db/schema/enums";

export type CaseStatus = (typeof caseStatusEnum.enumValues)[number];
type DocumentType = (typeof documentTypeEnum.enumValues)[number];

export const CASE_STATUSES = [
  "intake",
  "documents_pending",
  "extracting",
  "ready_to_build",
  "building",
  "build_failed",
  "draft_ready",
  "in_review",
  "needs_revision",
  "approved",
  "package_ready",
  "delivered",
  "filed",
  "archived",
] as const satisfies readonly CaseStatus[];

/**
 * Edge list. Each entry: `from` → `to[]` legal moves.
 * Owning stage in parens for traceability.
 */
const TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  intake: ["documents_pending", "archived"], // Stage 05: completeIntake
  documents_pending: ["extracting", "archived"], // Stage 06
  extracting: ["ready_to_build", "build_failed", "archived"], // Stage 06/07
  ready_to_build: ["building", "archived"], // Stage 07
  building: ["draft_ready", "build_failed", "archived"], // Stage 07
  // `build_failed → building` is the retry edge: requestBuild kicks
  // a fresh run directly. Threading through ready_to_build first
  // would be a no-op hop. `→ ready_to_build` stays legal so an admin /
  // future "reset" tool can rewind to the pre-build state.
  build_failed: ["building", "ready_to_build", "archived"], // Stage 07 (retry)
  draft_ready: ["in_review", "archived"], // Stage 08
  in_review: ["needs_revision", "approved", "archived"], // Stage 08
  needs_revision: ["in_review", "archived"], // Stage 08
  // ADR-006: `approved → in_review` is the backslide path when an
  // attorney unapproves or regenerates an output that was part of a
  // fully-approved set. Phase 1 routes through `in_review` rather than
  // lighting up `needs_revision`.
  // `approved → delivered` collapses the formal `package_ready` step
  // (Phase 1 sub-decision 4) — `downloadPackage` does compile + URL
  // hand-off atomically, so the intermediate state has no observable
  // dwell. Phase 2 will add `package_ready` back when packaging moves
  // to a background job.
  approved: ["in_review", "delivered", "package_ready", "archived"],
  package_ready: ["delivered", "archived"], // Stage 08
  delivered: ["filed", "archived"], // Stage 08 / attorney
  // ADR-006: `filed → delivered` is the admin reverse path
  // (`admin.case.unmarkFiled`). No attorney UI exposes it — the reverse
  // is operational-only and audited via `admin_audit_log`.
  filed: ["delivered", "archived"],
  archived: [], // terminal
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function legalNextStatuses(from: CaseStatus): readonly CaseStatus[] {
  return TRANSITIONS[from];
}

/**
 * Statuses where the attorney is allowed to upload new evidence files.
 * `build_failed` is included — the attorney typically adds/replaces a
 * missing document and retries the build.
 */
export const UPLOADABLE_STATUSES = [
  "intake",
  "documents_pending",
  "extracting",
  "ready_to_build",
  "build_failed",
  "needs_revision",
] as const satisfies readonly CaseStatus[];

/**
 * Signed recommendation letters arrive *after* the build: the build
 * produces `recommendation_letter_template` drafts → attorney sends to
 * recommender → recommender returns a signed PDF → attorney uploads it
 * as a `case_documents` row (`documentType = "recommendation_letter"`).
 * That upload happens during the post-build review window, so the guard
 * has to stay open through `approved`. We stop at `approved` because
 * `package_ready` means the package PDF is already compiled — a new
 * letter then would desync the bundle.
 */
export const RECOMMENDATION_LETTER_UPLOAD_STATUSES = [
  ...UPLOADABLE_STATUSES,
  "draft_ready",
  "in_review",
  "approved",
] as const satisfies readonly CaseStatus[];

export function canUploadInStatus(
  s: CaseStatus,
  documentType?: DocumentType,
): boolean {
  if (documentType === "recommendation_letter") {
    return (RECOMMENDATION_LETTER_UPLOAD_STATUSES as readonly CaseStatus[]).includes(s);
  }
  return (UPLOADABLE_STATUSES as readonly CaseStatus[]).includes(s);
}

/**
 * Statuses from which the attorney can request a build (Stage 07).
 * `ready_to_build` is the post-extraction happy path; `build_failed` is the
 * retry path. Pre-extraction statuses (`intake`, `documents_pending`,
 * `extracting`) are NOT buildable — there's nothing to build with.
 * Post-build statuses (`building`, `draft_ready`, `in_review` etc.) reject
 * because a build is in flight or already done.
 */
export const BUILDABLE_STATUSES = [
  "ready_to_build",
  "build_failed",
] as const satisfies readonly CaseStatus[];

export function canRequestBuild(s: CaseStatus): boolean {
  return (BUILDABLE_STATUSES as readonly CaseStatus[]).includes(s);
}

/**
 * Statuses where intake-stage data (beneficiary fields, recommender
 * roster) is still mutable. Once the case has progressed past
 * `documents_pending` the build context is frozen — editing intake
 * data after that would silently desync from any in-flight or
 * completed build. Locking is enforced in the `case.updateBeneficiary`
 * mutation and the `recommender.*` mutations.
 */
export const INTAKE_EDITABLE_STATUSES = [
  "intake",
  "documents_pending",
] as const satisfies readonly CaseStatus[];

export function canEditIntake(s: CaseStatus): boolean {
  return (INTAKE_EDITABLE_STATUSES as readonly CaseStatus[]).includes(s);
}

/** Human-friendly status label (`needs_revision` → `Needs revision`). */
export function formatStatus(s: CaseStatus): string {
  const spaced = s.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Statuses where the package PDF has been delivered (or beyond) and
 * editing/regenerating an output would silently desync the bundle the
 * attorney already downloaded. ADR-006 closes that gap server-side
 * via {@link assertOutputMutationAllowed}; the lockset is the
 * single source of truth so the gate doesn't get duplicated across
 * five procedures.
 */
export const POST_PACKAGE_LOCKED_STATUSES = [
  "delivered",
  "filed",
  "archived",
] as const satisfies readonly CaseStatus[];

/**
 * Output-mutation procedures that participate in the post-package
 * lockset. `output.approve` is the exception: re-approving after a
 * partial backslide is a normal review path, so it's only blocked
 * from `archived`.
 */
export type LockableOutputMutation =
  | "output.update"
  | "output.unapprove"
  | "output.regenerate"
  | "output.restoreVersion"
  | "output.approve";

/**
 * Throws `AppError("CONFLICT", ...)` if the case status forbids the
 * given output mutation. Mirrors the existing `canRequestBuild` /
 * `canEditIntake` / `canUploadInStatus` helpers — call once at the top
 * of each procedure body to centralize the gate.
 *
 * Lockset matrix:
 *   - `output.update` / `output.unapprove` / `output.regenerate` /
 *     `output.restoreVersion`: rejected from
 *     {@link POST_PACKAGE_LOCKED_STATUSES} (`delivered`, `filed`,
 *     `archived`).
 *   - `output.approve`: rejected only from `archived`. Re-approval
 *     after an unapprove or regenerate is a normal review path.
 *
 * The error message points the attorney at `admin.case.unmarkFiled`
 * for the `delivered` / `filed` cases — the operational reverse that
 * unlocks the case for further edits.
 */
export function assertOutputMutationAllowed(
  status: CaseStatus,
  mutation: LockableOutputMutation,
): void {
  if (mutation === "output.approve") {
    if (status === "archived") {
      throw new AppError(
        "CONFLICT",
        "Cannot approve outputs on an archived case.",
      );
    }
    return;
  }
  if (
    (POST_PACKAGE_LOCKED_STATUSES as readonly CaseStatus[]).includes(status)
  ) {
    if (status === "archived") {
      throw new AppError(
        "CONFLICT",
        `Cannot ${mutation.replace("output.", "")} outputs on an archived case.`,
      );
    }
    throw new AppError(
      "CONFLICT",
      `Case is ${status} — the package PDF has already been delivered. Ask an admin to unmark it (admin.case.unmarkFiled) before editing outputs.`,
    );
  }
}
