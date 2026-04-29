import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { caseDocuments, cases } from "@/server/db/schema";
import { AppError } from "@/lib/errors";
import { EvidencePlanSchema } from "@/server/db/schema/zod";
import type { EvidencePlan } from "@/server/db/schema/zod";
import { getCurrentOutput } from "@/server/services/output";
import type { BuildContext } from "@/server/services/computer/prompts/context";

/**
 * Loads everything the build pipeline needs from one DB read pass.
 * Called from the parent `case-build` orchestrator at run start AND from
 * `regenerate-output` for single-output reruns.
 *
 * Truncation: per-doc extracted text is sliced to `DOCUMENT_TEXT_BUDGET`
 * (50k chars). Above that, prompts blow past Sonar's context window and
 * cost spikes for marginal grounding. The `truncated` flag lets the
 * prompt builder decide whether to flag the omission to the model.
 *
 * Recommenders: empty for now. Stage 5 intake doesn't yet store them;
 * when it does, this loader is the single place to add the read.
 *
 * `evidencePlan: null` is the convention for "no evidence plan yet" —
 * sub-functions that depend on it (personal-statement, petition-letter,
 * recommendation-letter) throw when it's null. The parent populates it
 * after the evidence-plan step succeeds.
 */

export const DOCUMENT_TEXT_BUDGET = 50_000;

export async function loadBuildContext(caseId: string): Promise<BuildContext> {
  const [caseRow] = await db
    .select({
      id: cases.id,
      visaType: cases.visaType,
      beneficiaryData: cases.beneficiaryData,
      updatedAt: cases.updatedAt,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!caseRow) {
    // NOT_FOUND propagates upward; parent treats as build_failed.
    throw new AppError("NOT_FOUND", `case ${caseId} not found`);
  }

  // Resolve the current evidence plan from `case_outputs` (single source
  // of truth). Migration 0012 dropped the `cases.evidence_plan` jsonb
  // cache that previously diverged from the row written by the
  // evidence-plan sub-function (open_issues #21).
  const evidencePlanOutput = await getCurrentOutput({
    db,
    caseId,
    outputType: "evidence_plan",
  });
  const evidencePlan: EvidencePlan | null = (() => {
    if (!evidencePlanOutput?.content) return null;
    try {
      const parsed: unknown = JSON.parse(evidencePlanOutput.content);
      const result = EvidencePlanSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      // Non-JSON content (e.g. mid-edit attorney prose). Downstream
      // prompts will throw on null, surfacing the inconsistency.
      return null;
    }
  })();

  const docs = await db
    .select({
      id: caseDocuments.id,
      type: caseDocuments.documentType,
      originalFilename: caseDocuments.originalFilename,
      extractedText: caseDocuments.extractedText,
    })
    .from(caseDocuments)
    .where(
      and(eq(caseDocuments.caseId, caseId), isNull(caseDocuments.deletedAt)),
    )
    // `.id` as tiebreaker: createdAt has ms precision and a bulk upload
    // can land two rows in the same tick — without a stable secondary
    // sort the prompt's document numbering would shift between runs and
    // citation references (`Exhibit 3`) would point at different files.
    .orderBy(asc(caseDocuments.createdAt), asc(caseDocuments.id));

  return {
    caseId,
    snapshotAt: caseRow.updatedAt.toISOString(),
    visaType: caseRow.visaType,
    beneficiary: caseRow.beneficiaryData ?? {},
    documents: docs.map((d) => {
      const text = d.extractedText ?? "";
      const truncated = text.length > DOCUMENT_TEXT_BUDGET;
      return {
        id: d.id,
        type: d.type,
        originalFilename: d.originalFilename,
        extractedText: truncated ? text.slice(0, DOCUMENT_TEXT_BUDGET) : text,
        truncated,
      };
    }),
    evidencePlan,
    // TODO(stage-8): pull recommenders once intake stores them.
    recommenders: [],
  };
}
