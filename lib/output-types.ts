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
