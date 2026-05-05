import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  caseDocuments,
  caseRecommenders,
} from "@/server/db/schema";
import type { Db } from "@/server/db/client";

/**
 * Aggregate signed-letter coverage for a case.
 *
 * Phase-1 limitation: `case_documents` has NO FK to `case_recommenders`
 * (see `server/db/schema/cases.ts:204` and `recommenders.ts:33`), so we
 * CANNOT determine which uploaded `recommendation_letter` corresponds
 * to which recommender. The coverage check is therefore intentionally
 * COUNT-BASED — `signedLetterCount >= recommenderCount` ⇒ treat the
 * package as fully signed; any shortfall ⇒ every
 * `recommendation_letter_template` page in the package gets a
 * "DRAFT — UNSIGNED" watermark, since we can't safely tell which one
 * is missing its return.
 *
 * When per-letter resolution lands (Phase 2 schema change adding
 * `case_documents.recommender_id`), swap this aggregate for a
 * per-recommender `Map<recommenderId, signed: boolean>`.
 */
export type RecommenderLetterCoverage = {
  /** Live recommenders on the case (deleted_at IS NULL). */
  recommenderCount: number;
  /** Live `recommendation_letter` uploads (deleted_at IS NULL). */
  signedLetterCount: number;
  /** True iff `signedLetterCount >= recommenderCount`. The case with
   *  zero recommenders also returns `true` — the package contains no
   *  recommendation-letter pages, so there's nothing to watermark. */
  allSigned: boolean;
  /** Names of every live recommender, in `displayOrder`. Used for the
   *  cover-page "Pending signed letters" block. */
  recommenderNames: ReadonlyArray<string>;
};

export async function computeRecommenderLetterCoverage(args: {
  db: Db;
  caseId: string;
}): Promise<RecommenderLetterCoverage> {
  const recommenders = await args.db
    .select({ fullName: caseRecommenders.fullName })
    .from(caseRecommenders)
    .where(
      and(
        eq(caseRecommenders.caseId, args.caseId),
        isNull(caseRecommenders.deletedAt),
      ),
    )
    .orderBy(caseRecommenders.displayOrder);

  const [docCounts] = await args.db
    .select({
      signed: sql<number>`count(*) filter (where ${caseDocuments.documentType} = 'recommendation_letter')::int`,
    })
    .from(caseDocuments)
    .where(
      and(
        eq(caseDocuments.caseId, args.caseId),
        isNull(caseDocuments.deletedAt),
      ),
    );

  const recommenderCount = recommenders.length;
  const signedLetterCount = docCounts?.signed ?? 0;
  return {
    recommenderCount,
    signedLetterCount,
    allSigned: signedLetterCount >= recommenderCount,
    recommenderNames: recommenders.map((r) => r.fullName),
  };
}
