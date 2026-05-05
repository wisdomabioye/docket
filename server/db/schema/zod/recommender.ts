import { z } from "zod";

/**
 * Single source of truth for recommender form + API input. Consumed by:
 *   - `server/api/routers/recommender.ts` (tRPC mutations)
 *   - `components/case/RecommenderListEditor.tsx` (form validation)
 *
 * The shape mirrors `caseRecommenders` columns. Fields that the table
 * stores nullable accept either a non-empty trimmed string OR `null` —
 * the empty-string-is-not-input rule from the user's memory rule
 * (`feedback_no_empty_string_optional.md`) is enforced by `.min(1)`
 * before `.optional().nullable()`.
 */

const NonEmpty = (max: number) => z.string().trim().min(1).max(max);
const NullableNonEmpty = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? null : v));

export const RecommenderInputSchema = z.object({
  fullName: NonEmpty(200),
  relationship: NonEmpty(500),
  titleOrg: NullableNonEmpty(200),
  email: z.email().max(200).nullable().optional().transform((v) => v ?? null),
  guidance: NullableNonEmpty(5000),
});

export type RecommenderInput = z.infer<typeof RecommenderInputSchema>;

/** Patch shape for `update`: every field optional, but if provided
 *  must satisfy the same constraints. Used so the form can save a
 *  single touched field without re-sending the whole record. */
export const RecommenderPatchSchema = RecommenderInputSchema.partial();
export type RecommenderPatch = z.infer<typeof RecommenderPatchSchema>;
