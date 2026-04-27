import { z } from "zod";

/**
 * Schema for `cases.beneficiary_data` (jsonb).
 *
 * **This file is the single source of truth for the column's shape.**
 * `cases.beneficiaryData` in `server/db/schema/cases.ts` is annotated with
 * `.$type<BeneficiaryData>()` so Drizzle's inferred row type stays in sync.
 *
 * Phase 1 stub — Stage 05 (intake form) extends the field set. Validate at
 * the service-layer boundary on every read/write.
 */
// `.partial()` makes every field optional; no need for per-field `.optional()`.
export const BeneficiaryDataSchema = z
  .object({
    fullName: z.string().min(1).max(200),
    dateOfBirth: z.iso.date(), // ISO 8601 YYYY-MM-DD
    nationality: z.string().min(2).max(100),
    currentLocation: z.string().max(200),
    occupation: z.string().max(200),
    email: z.email(),
    notes: z.string().max(5000),
  })
  .partial()
  .strict();

export type BeneficiaryData = z.infer<typeof BeneficiaryDataSchema>;
