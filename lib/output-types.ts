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
