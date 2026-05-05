import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseOutputs,
  caseParticipants,
  cases,
} from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { AppError } from "@/lib/errors";
import { computeCriteriaCoverage } from "./criteria-coverage";
import { computeRecommenderLetterCoverage } from "./recommender-coverage";
import { visaCriteriaConfig } from "@/lib/visa-criteria";

/**
 * Stage 11 β package pre-flight checker. Mockup `package.html`
 * `.checks` (l. 107-127) lists 12 gates; we ship the four with real
 * data today and surface them honestly:
 *
 *   1. Approved outputs present     — count > 0 of currently-approved
 *                                       outputs for the case
 *   2. Criteria threshold met       — `metCount >= minCriteriaMet` from
 *                                       `computeCriteriaCoverage`
 *   3. Recommender letters approved — at least one approved
 *                                       `recommendation_letter_template`
 *                                       (heuristic; future: per-recommender
 *                                       count rule)
 *   4. Attorney bar standing active — primary attorney's profile.status
 *                                       is `active`
 *
 * Returns `allOk` so the page can disable the Download CTA in one
 * boolean check. Each gate carries a `detail` string for the row
 * subtitle in the UI.
 *
 * Up to 5 SQL round-trips per call: case row, primary participant,
 * output counts, criteria-coverage docs scan (inside
 * `computeCriteriaCoverage`), attorney profile. Could be combined,
 * but at current per-case cardinality (<50 docs, <20 outputs) the
 * 5-statement budget is well under any latency budget. Revisit if
 * the case page p95 ever shows up on the slow-query list.
 */

export type PreflightGate = {
  /** Stable id for React key + tests. */
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Informational rows that surface state but don't block the
   *  Download CTA. The aggregate `allOk` is computed only from
   *  non-advisory gates. Used for the signed-letter coverage row,
   *  which informs the attorney without preventing them from
   *  downloading the watermarked draft package. */
  advisory?: boolean;
};

export type PreflightResult = {
  allOk: boolean;
  gates: ReadonlyArray<PreflightGate>;
};

export async function computePreflight(args: {
  db: Db;
  caseId: string;
}): Promise<PreflightResult> {
  // 1. Case visa + primary attorney user id (one round-trip).
  const [caseRow] = await args.db
    .select({
      id: cases.id,
      visaType: cases.visaType,
    })
    .from(cases)
    .where(and(eq(cases.id, args.caseId), isNull(cases.deletedAt)))
    .limit(1);
  if (!caseRow) {
    throw new AppError("NOT_FOUND", `case ${args.caseId} not found`);
  }
  const config = visaCriteriaConfig(caseRow.visaType);

  const [primaryRow] = await args.db
    .select({ userId: caseParticipants.userId })
    .from(caseParticipants)
    .where(
      and(
        eq(caseParticipants.caseId, args.caseId),
        eq(caseParticipants.isPrimary, true),
        isNull(caseParticipants.removedAt),
      ),
    )
    .limit(1);

  // 2. Output approvals (one round-trip; both totals come from the
  // same scan).
  const [outputCounts] = await args.db
    .select({
      approved: sql<number>`count(*) filter (where ${caseOutputs.attorneyApproved} = true and ${caseOutputs.isCurrent} = true and ${caseOutputs.deletedAt} is null)::int`,
      approvedRecLetters: sql<number>`count(*) filter (where ${caseOutputs.attorneyApproved} = true and ${caseOutputs.isCurrent} = true and ${caseOutputs.deletedAt} is null and ${caseOutputs.outputType} = 'recommendation_letter_template')::int`,
    })
    .from(caseOutputs)
    .where(eq(caseOutputs.caseId, args.caseId));

  // 3. Coverage (re-uses the Overview card's query).
  const coverage = await computeCriteriaCoverage({
    db: args.db,
    caseId: args.caseId,
    visaType: caseRow.visaType,
  });

  // 3b. Signed-letter coverage — drives the advisory row below AND the
  // package PDF's watermark/draft-badge logic. Count-based until
  // `case_documents` gains a recommender FK (Phase 2).
  const letterCoverage = await computeRecommenderLetterCoverage({
    db: args.db,
    caseId: args.caseId,
  });

  // 4. Attorney bar status. Primary may be missing on legacy data —
  // treat as a failed gate rather than a server error.
  let attorneyActive = false;
  if (primaryRow) {
    const [profile] = await args.db
      .select({ status: attorneyProfiles.status })
      .from(attorneyProfiles)
      .where(
        and(
          eq(attorneyProfiles.userId, primaryRow.userId),
          isNull(attorneyProfiles.deletedAt),
        ),
      )
      .limit(1);
    attorneyActive = profile?.status === "active";
  }

  const approvedCount = outputCounts?.approved ?? 0;
  const approvedRecLetters = outputCounts?.approvedRecLetters ?? 0;

  const gates: PreflightGate[] = [
    {
      id: "outputs_approved",
      label: "Approved outputs present",
      ok: approvedCount > 0,
      detail:
        approvedCount === 0
          ? "Approve at least one output on the Outputs tab."
          : `${approvedCount} approved output${approvedCount === 1 ? "" : "s"} ready to bundle.`,
    },
    {
      id: "criteria_threshold",
      label: config
        ? `${coverage.metCount} of ${coverage.rows.length} criteria established`
        : "Criteria threshold met",
      ok: config ? coverage.metCount >= config.minCriteriaMet : true,
      detail: config
        ? coverage.metCount >= config.minCriteriaMet
          ? `Exceeds the ${config.minCriteriaMet}-of-${coverage.rows.length} minimum for ${caseRow.visaType}.`
          : `Need at least ${config.minCriteriaMet} of ${coverage.rows.length} criteria with evidence; only ${coverage.metCount} met today.`
        : `${caseRow.visaType} has no criteria taxonomy in Phase 1; threshold check skipped.`,
    },
    {
      id: "recommender_letters",
      label: "Recommendation letters approved",
      ok: approvedRecLetters > 0,
      detail:
        approvedRecLetters > 0
          ? `${approvedRecLetters} approved recommendation letter${approvedRecLetters === 1 ? "" : "s"}.`
          : "At least one recommendation letter must be approved on the Outputs tab.",
    },
    {
      id: "attorney_bar_active",
      label: "Attorney bar standing active",
      ok: attorneyActive,
      detail: attorneyActive
        ? "Primary attorney's profile is active."
        : "Primary attorney's profile must be active to file.",
    },
    {
      id: "signed_letters_uploaded",
      label: "Signed recommendation letters uploaded",
      // Treated as `ok` once every recommender has a corresponding
      // signed upload. `advisory: true` keeps the Download CTA
      // unblocked when partial — the package PDF will watermark the
      // unsigned letter pages instead. See `pdf/index.tsx`
      // `compileFullPackagePdf`.
      ok: letterCoverage.allSigned,
      advisory: true,
      detail:
        letterCoverage.recommenderCount === 0
          ? "No recommenders on this case yet — nothing to collect."
          : letterCoverage.allSigned
            ? `${letterCoverage.signedLetterCount} of ${letterCoverage.recommenderCount} signed letters uploaded.`
            : `${letterCoverage.signedLetterCount} of ${letterCoverage.recommenderCount} signed letters uploaded — unsigned drafts in the package will be watermarked DRAFT.`,
    },
  ];

  return {
    // Advisory rows surface state without blocking the CTA, so they
    // don't count toward `allOk`.
    allOk: gates.filter((g) => !g.advisory).every((g) => g.ok),
    gates,
  };
}
