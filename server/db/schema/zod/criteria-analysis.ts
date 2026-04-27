import { z } from "zod";

/**
 * Schema for `cases.criteria_analysis` (jsonb). Linked into Drizzle via
 * `.$type<CriteriaAnalysis>()`.
 *
 * Phase 1 stub — Stage 07 (Computer integration) defines the canonical shape
 * after first real outputs are generated.
 */
export const CriteriaAnalysisSchema = z
  .object({
    visaType: z.string(),
    metCount: z.number().int().nonnegative(),
    requiredCount: z.number().int().nonnegative(),
    items: z.array(
      z
        .object({
          criterion: z.string(),
          met: z.boolean(),
          rationale: z.string().max(4000),
          supportingExhibits: z.array(z.string().max(200)).default([]),
        })
        .strict(),
    ),
  })
  .strict();

export type CriteriaAnalysis = z.infer<typeof CriteriaAnalysisSchema>;
