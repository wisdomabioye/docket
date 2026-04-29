import { z } from "zod";

/**
 * Schema for `case_outputs.metadata` (jsonb). Linked into Drizzle via
 * `.$type<OutputMetadata>()`.
 *
 * Shape varies by `output_type`. Stage 08 locks this as a
 * `z.discriminatedUnion("type", ...)` so the typed branches actually
 * validate — `z.union` previously matched `GenericMetadata` (which is
 * `passthrough()`) for any malformed shape, silently accepting bad data
 * on `recommendation_letter_template` / `exhibit_index` rows. Resolves
 * open_issues #19.4.
 */

const RecommendationLetterMetadata = z
  .object({
    type: z.literal("recommendation_letter_template"),
    recommenderName: z.string().max(200).optional(),
    recommenderRelationship: z.string().max(500).optional(),
    recommenderTitle: z.string().max(200).optional(),
    /** Provider attribution stamped by `runOutputJob`. */
    provider: z.string().max(50).optional(),
    sessionId: z.string().max(200).optional(),
    model: z.string().max(100).optional(),
    finishReason: z.string().max(50).nullable().optional(),
    outputType: z.string().max(50).optional(),
    citations: z.array(z.string().max(2000)).optional(),
    searchResults: z.array(z.unknown()).optional(),
    regenerationGuidance: z.string().max(5000).optional(),
  })
  .strict();

const ExhibitIndexMetadata = z
  .object({
    type: z.literal("exhibit_index"),
    exhibitCount: z.number().int().nonnegative().optional(),
    provider: z.string().max(50).optional(),
    sessionId: z.string().max(200).optional(),
    model: z.string().max(100).optional(),
    finishReason: z.string().max(50).nullable().optional(),
    outputType: z.string().max(50).optional(),
    citations: z.array(z.string().max(2000)).optional(),
    searchResults: z.array(z.unknown()).optional(),
    regenerationGuidance: z.string().max(5000).optional(),
  })
  .strict();

/**
 * Catch-all branch for output types whose metadata shape isn't yet
 * locked (`evidence_plan`, `personal_statement`, `petition_letter`,
 * `criteria_analysis`, `cover_letter`, `form_g1145`, `other`). Uses
 * `z.literal` enum on the discriminator so the discriminator selector
 * picks the right branch deterministically.
 */
const GenericMetadata = z
  .object({
    type: z.enum([
      "evidence_plan",
      "personal_statement",
      "petition_letter",
      "criteria_analysis",
      "cover_letter",
      "form_g1145",
      "other",
    ]),
    notes: z.string().max(2000).optional(),
    provider: z.string().max(50).optional(),
    sessionId: z.string().max(200).optional(),
    model: z.string().max(100).optional(),
    finishReason: z.string().max(50).nullable().optional(),
    outputType: z.string().max(50).optional(),
    citations: z.array(z.string().max(2000)).optional(),
    searchResults: z.array(z.unknown()).optional(),
    regenerationGuidance: z.string().max(5000).optional(),
  })
  .passthrough();

export const OutputMetadataSchema = z.discriminatedUnion("type", [
  RecommendationLetterMetadata,
  ExhibitIndexMetadata,
  GenericMetadata,
]);

export type OutputMetadata = z.infer<typeof OutputMetadataSchema>;
