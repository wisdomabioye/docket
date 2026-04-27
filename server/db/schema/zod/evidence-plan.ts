import { z } from "zod";

/**
 * Schema for `cases.evidence_plan` (jsonb). Source of truth for the column's
 * shape; linked into Drizzle via `.$type<EvidencePlan>()`.
 *
 * Phase 1 stub — Stage 05 specifies the per-criterion structure (assessment,
 * evidence summary, gaps, recommendation).
 */
export const EvidencePlanCriterionSchema = z
  .object({
    criterion: z.string().min(1).max(200),
    assessment: z.enum(["strong", "moderate", "weak", "absent"]),
    summary: z.string().max(2000),
    gaps: z.array(z.string().max(500)).default([]),
    recommendation: z.string().max(2000).optional(),
  })
  .strict();

export const EvidencePlanSchema = z
  .object({
    visaType: z.string(),
    overallStrength: z.enum(["strong", "moderate", "weak"]),
    criteria: z.array(EvidencePlanCriterionSchema),
    generatedAt: z.iso.datetime(),
  })
  .strict();

export type EvidencePlanCriterion = z.infer<typeof EvidencePlanCriterionSchema>;
export type EvidencePlan = z.infer<typeof EvidencePlanSchema>;
