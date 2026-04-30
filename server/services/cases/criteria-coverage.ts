import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { caseDocuments } from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import {
  criteriaFor,
  criteriaForDocumentType,
  strengthFor,
  type CriterionStrength,
} from "@/lib/visa-criteria";
import type { DocumentType } from "@/lib/constants";

/**
 * Single source of truth for "how strong is each criterion's evidence
 * on this case". Used by:
 *   - Overview Evidence-strength card (renders every row).
 *   - Package preflight's "N of M criteria met" gate.
 *
 * One round-trip: select all live `case_documents` for the case
 * (RLS-engaged via `args.db`), then aggregate per-criterion in TypeScript
 * via the static `documentType → criterion[]` map from `lib/visa-criteria`.
 *
 * In TS, not SQL: keeping the join out of SQL means a future change to
 * the heuristic mapping is a one-file edit (`visa-criteria.ts`) — no
 * VALUES table, no SQL CASE expression to maintain.
 *
 * Cost: O(documents) memory + a single bounded scan. Per-case
 * documents are < 50 in practice; trivial. The query is index-served
 * by `case_documents_case_idx`.
 */

export type CriterionCoverage = {
  code: number;
  name: string;
  description: string;
  exhibitCount: number;
  strength: CriterionStrength;
};

export type CoverageResult = {
  visaSupported: boolean;
  /** Empty array when `visaSupported` is false (UI renders EmptyState). */
  rows: ReadonlyArray<CriterionCoverage>;
  /** Number of rows with `strength !== "none"`. Used by the preflight
   *  gate; cheap pre-computation here keeps the caller lean. */
  metCount: number;
};

export async function computeCriteriaCoverage(args: {
  db: Db;
  caseId: string;
  visaType: string;
}): Promise<CoverageResult> {
  const criteria = criteriaFor(args.visaType);
  if (criteria.length === 0) {
    return { visaSupported: false, rows: [], metCount: 0 };
  }

  // Pull every live document's `documentType` for this case. RLS will
  // hide cross-case rows; cross-attorney leakage is impossible because
  // the join in the calling tRPC procedure already gates by RLS.
  const docs = await args.db
    .select({ documentType: caseDocuments.documentType })
    .from(caseDocuments)
    .where(
      and(
        eq(caseDocuments.caseId, args.caseId),
        isNull(caseDocuments.deletedAt),
      ),
    );

  // Tally: for each document, fan it out to the criteria its type
  // typically supports (`criteriaForDocumentType`), then count per
  // criterion. A document that supports two criteria (e.g. a
  // recommendation_letter → criteria 5 + 7) contributes one exhibit
  // to BOTH counts — that's the same model the mockup implies, and
  // matches how an attorney would describe the case in a brief.
  const counts = new Map<number, number>();
  for (const doc of docs) {
    for (const criterionCode of criteriaForDocumentType(
      doc.documentType as DocumentType,
    )) {
      counts.set(criterionCode, (counts.get(criterionCode) ?? 0) + 1);
    }
  }

  const rows: CriterionCoverage[] = criteria.map((c) => {
    const count = counts.get(c.code) ?? 0;
    return {
      code: c.code,
      name: c.name,
      description: c.description,
      exhibitCount: count,
      strength: strengthFor(count),
    };
  });

  const metCount = rows.filter((r) => r.strength !== "none").length;

  return { visaSupported: true, rows, metCount };
}
