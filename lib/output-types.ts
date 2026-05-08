import type { OutputType } from "@/server/services/computer/types";

/**
 * Human-readable display labels for `output_type` enum values. Single
 * source of truth for output-card titles, PDF headings, and dashboard
 * progress copy. Keep in sync with `outputTypeEnum` in
 * `server/db/schema/enums.ts` — TypeScript's `Record<OutputType, ...>`
 * forces every key to be present, so adding a new enum value triggers
 * a compile error here until the label lands.
 */
export const OUTPUT_TYPE_DISPLAY: Record<OutputType, string> = {
  evidence_plan: "Evidence Plan",
  personal_statement: "Personal Statement",
  petition_letter: "Petition Letter",
  recommendation_letter_template: "Recommendation Letter",
  exhibit_index: "Exhibit Index",
  criteria_analysis: "Criteria Analysis",
  cover_letter: "Cover Letter",
  form_g1145: "Form G-1145",
  other: "Other",
};

/**
 * Output types that are upstream scaffolding for downstream prompts —
 * NOT attorney-facing filing artifacts. They keep generating and
 * feeding `loadBuildContext` (per-prompt input grounding), but are
 * hidden from:
 *   - the outputs grid (`output.list` → `getCurrentOutputsForList`)
 *   - the per-output detail page (`output.get` returns NOT_FOUND)
 *   - the approval tally `total` (`summarizeOutputApprovals`), so
 *     `package.ready` notification can fire when every *visible*
 *     output is approved
 *   - the bundled package PDF (`compileFullPackagePdf`)
 *   - canonical package order (`PACKAGE_ORDER` in `pdf/package.tsx`)
 *
 * `evidence_plan` is the only entry today. `criteria_analysis` is
 * planned as a real filing artifact (spec §2.2) and intentionally
 * excluded.
 */
const INTERNAL_OUTPUT_TYPES_ARRAY: ReadonlyArray<OutputType> = ["evidence_plan"];
const INTERNAL_OUTPUT_TYPES_SET: ReadonlySet<OutputType> = new Set(
  INTERNAL_OUTPUT_TYPES_ARRAY,
);

export function isInternalOutputType(t: OutputType): boolean {
  return INTERNAL_OUTPUT_TYPES_SET.has(t);
}

/** As a typed string array — for SQL `not in` filters and tests. */
export const INTERNAL_OUTPUT_TYPES: ReadonlyArray<OutputType> =
  INTERNAL_OUTPUT_TYPES_ARRAY;

/**
 * Pulls the recommender's display name out of an output's metadata
 * (when the output is `recommendation_letter_template`). Returns null
 * for non-recommendation types AND for missing/malformed metadata.
 *
 * Single source for the extraction logic — used by `OutputCard`, the
 * package page, and the PDF service. Without it, three call sites
 * would carry near-identical `typeof === "object" + "in" + cast`
 * dances and drift over time.
 */
export function readRecommenderName(args: {
  outputType: OutputType;
  metadata: unknown;
}): string | null {
  if (args.outputType !== "recommendation_letter_template") return null;
  if (
    args.metadata !== null &&
    typeof args.metadata === "object" &&
    "recommenderName" in args.metadata
  ) {
    const v = (args.metadata as { recommenderName?: unknown }).recommenderName;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}
