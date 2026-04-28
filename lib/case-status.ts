/**
 * Case status state machine.
 *
 * `caseStatusEnum` (14 values) is the column type. This file is the
 * source of truth for which transitions are *legal*. The service layer
 * (`server/services/cases/transition.ts`) enforces it on every status
 * write — Postgres can't.
 *
 * Stage 05 ships the `intake → documents_pending` transition. Other
 * stages (06 extraction, 07 build, 08 review/package, plus admin
 * archival) plug into the same map by adding edges below — there is no
 * other code path that may mutate `cases.status`.
 *
 * Terminal states (no outgoing edges): `archived`. `filed` only goes to
 * `archived` (admin action).
 *
 * Illegal transitions throw `AppError("CONFLICT", ...)` from the
 * transition service.
 */

import type { caseStatusEnum } from "@/server/db/schema/enums";

export type CaseStatus = (typeof caseStatusEnum.enumValues)[number];

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
  build_failed: ["ready_to_build", "archived"], // Stage 07 (retry)
  draft_ready: ["in_review", "archived"], // Stage 08
  in_review: ["needs_revision", "approved", "archived"], // Stage 08
  needs_revision: ["in_review", "archived"], // Stage 08
  approved: ["package_ready", "archived"], // Stage 08
  package_ready: ["delivered", "archived"], // Stage 08
  delivered: ["filed", "archived"], // Stage 08 / attorney
  filed: ["archived"], // admin
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

export function canUploadInStatus(s: CaseStatus): boolean {
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

/** Human-friendly status label (`needs_revision` → `Needs revision`). */
export function formatStatus(s: CaseStatus): string {
  const spaced = s.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
