import { z } from "zod";

/**
 * Schema for `case_outputs.metadata` (jsonb). Linked into Drizzle via
 * `.$type<OutputMetadata>()`.
 *
 * Shape varies by `output_type`. Stage 08 (output review) locks the per-type
 * schemas. Use `.parse(value)` at the service boundary; the service narrows
 * by `output_type` to the more specific schema.
 */

const RecommendationLetterMetadata = z
  .object({
    type: z.literal("recommendation_letter_template"),
    recommenderName: z.string().max(200).optional(),
    recommenderRelationship: z.string().max(500).optional(),
    recommenderTitle: z.string().max(200).optional(),
  })
  .strict();

const ExhibitIndexMetadata = z
  .object({
    type: z.literal("exhibit_index"),
    exhibitCount: z.number().int().nonnegative().optional(),
  })
  .strict();

const GenericMetadata = z
  .object({
    type: z.string(),
    notes: z.string().max(2000).optional(),
  })
  .passthrough();

export const OutputMetadataSchema = z.union([
  RecommendationLetterMetadata,
  ExhibitIndexMetadata,
  GenericMetadata,
]);

export type OutputMetadata = z.infer<typeof OutputMetadataSchema>;
