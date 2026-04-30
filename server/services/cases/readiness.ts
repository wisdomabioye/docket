import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { caseDocuments, cases } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import type { CaseStatus } from "@/lib/case-status";
import { transitionCase } from "@/server/services/cases/transition";

/**
 * Checks whether a case has the data the build pipeline needs. Called
 * from `case.requestBuild` (Phase 11) before emitting the event AND
 * from the build page (Stage 7 UI) to render readiness state.
 *
 * Single source of truth for "buildable" — content gates are:
 *   1. Beneficiary `fullName` is set (used in every prompt's lead).
 *   2. At least one document has finished extraction with non-empty
 *      `extracted_text`. Without any text the prose outputs would be
 *      grounded in nothing.
 *   3. No documents are still in `pending` / `processing` extraction —
 *      kicking a build now would either block on extraction or skip
 *      half the evidence; either is worse than waiting.
 *
 * Returns the case `status` alongside the readiness verdict so callers
 * don't need a second round-trip to apply the lifecycle gate
 * (`canRequestBuild` / `BUILDABLE_STATUSES` in `lib/case-status.ts`).
 * Lifecycle is checked at the call site — readiness is about CONTENT.
 */

export type BuildRequirementResult = {
  /** Current case status — caller applies `canRequestBuild` to decide. */
  status: CaseStatus;
} & (
  | { ok: true; reasons: readonly [] }
  | { ok: false; reasons: string[] }
);

export async function meetsBuildRequirements(args: {
  /** Pass the RLS-engaged tx (`ctx.db`) so unauthorized callers see a
   *  NOT_FOUND, not a content-leak via the reasons array. */
  db: Db;
  caseId: string;
}): Promise<BuildRequirementResult> {
  const [caseRow] = await args.db
    .select({
      status: cases.status,
      beneficiaryData: cases.beneficiaryData,
    })
    .from(cases)
    .where(and(eq(cases.id, args.caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!caseRow) {
    throw new AppError("NOT_FOUND", `case ${args.caseId} not found`);
  }

  // One round-trip for the document tallies. `count(*) FILTER (WHERE …)`
  // gives both numbers without a second query or a per-row scan.
  const [docCounts] = await args.db
    .select({
      extracted: sql<number>`count(*) filter (where ${caseDocuments.extractionStatus} = 'completed' and coalesce(length(${caseDocuments.extractedText}), 0) > 0)::int`,
      pendingExtraction: sql<number>`count(*) filter (where ${caseDocuments.extractionStatus} in ('pending', 'processing'))::int`,
    })
    .from(caseDocuments)
    .where(
      and(
        eq(caseDocuments.caseId, args.caseId),
        isNull(caseDocuments.deletedAt),
      ),
    );

  const reasons: string[] = [];
  const fullName = caseRow.beneficiaryData?.fullName?.trim() ?? "";
  if (!fullName) {
    reasons.push("Beneficiary full name is required.");
  }
  const extracted = docCounts?.extracted ?? 0;
  const pendingExtraction = docCounts?.pendingExtraction ?? 0;
  if (extracted === 0) {
    reasons.push(
      "Upload at least one document with extractable text (CV, publications, evidence).",
    );
  }
  if (pendingExtraction > 0) {
    reasons.push(
      `${pendingExtraction} document${pendingExtraction === 1 ? " is" : "s are"} still being processed — wait for extraction to finish before building.`,
    );
  }

  return reasons.length === 0
    ? { ok: true, status: caseRow.status, reasons: [] }
    : { ok: false, status: caseRow.status, reasons };
}

/**
 * Auto-promote a case's lifecycle status based on its documents'
 * extraction tallies. Called from `extractAndPersist` after every
 * extraction completes (success or failure).
 *
 * Two transitions are owned here:
 *   - `documents_pending → extracting` when at least one doc enters
 *     pending/processing extraction (the wave has started).
 *   - `extracting → ready_to_build` when zero docs are still pending
 *     AND at least one finished with non-empty extracted text.
 *   - `extracting → build_failed` when zero docs are still pending
 *     AND none have extractable text (every extraction failed). The
 *     attorney can re-upload from the documents page; `build_failed`
 *     is a legal start for `requestBuild` after they fix the input.
 *
 * Cases in any other status (intake, building, draft_ready, …) are
 * left alone: those lifecycle stages are not driven by extraction.
 *
 * Idempotent — calling twice in a row is safe (the inner
 * `transitionCase` no-ops on same-status writes). Wrap the call in
 * the same transaction as the doc-row update so the status flip and
 * the extraction completion land atomically.
 */
export async function reconcileCaseAfterExtraction(args: {
  /** OWNER-roled connection (or open tx). The status UPDATE must
   *  bypass RLS — this is a system-driven transition. */
  conn: Db;
  caseId: string;
}): Promise<void> {
  const [tally] = await args.conn
    .select({
      pending: sql<number>`count(*) filter (where ${caseDocuments.extractionStatus} in ('pending', 'processing'))::int`,
      completedWithText: sql<number>`count(*) filter (where ${caseDocuments.extractionStatus} = 'completed' and coalesce(length(${caseDocuments.extractedText}), 0) > 0)::int`,
      failed: sql<number>`count(*) filter (where ${caseDocuments.extractionStatus} = 'failed')::int`,
    })
    .from(caseDocuments)
    .where(
      and(
        eq(caseDocuments.caseId, args.caseId),
        isNull(caseDocuments.deletedAt),
      ),
    );

  const pending = tally?.pending ?? 0;
  const completedWithText = tally?.completedWithText ?? 0;
  const failed = tally?.failed ?? 0;

  // Read current status (the transition helper re-locks + re-reads,
  // but we want to short-circuit on irrelevant statuses without taking
  // a row lock for no reason).
  const [caseRow] = await args.conn
    .select({ status: cases.status })
    .from(cases)
    .where(and(eq(cases.id, args.caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!caseRow) return;
  const status = caseRow.status as CaseStatus;

  let next: CaseStatus | null = null;
  if (status === "documents_pending" && pending > 0) {
    next = "extracting";
  } else if (status === "extracting" && pending === 0) {
    if (completedWithText > 0) next = "ready_to_build";
    else if (failed > 0) next = "build_failed";
    // else: zero docs at all — leave at extracting; uploading another
    // doc will re-fire this reconciler.
  }

  if (!next) return;

  try {
    await transitionCase({
      tx: args.conn,
      caseId: args.caseId,
      toStatus: next,
      actor: { type: "system" },
      reason: "extraction reconciler",
    });
  } catch (err) {
    // Race: another concurrent reconciler may have transitioned the
    // case past us between the read and the write. The state machine
    // throws CONFLICT for illegal transitions; that's a no-op for us.
    if (err instanceof AppError && err.code === "CONFLICT") return;
    throw err;
  }
}
