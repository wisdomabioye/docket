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
//
// Stage 11 γ extends the field set for the multi-section wizard. The
// shape stays FLAT (no nested {profile:..., practice:...}) so all 8
// existing read sites (extractBeneficiaryFullName, prompts in
// _context.ts, PDF service, etc.) keep working unchanged. The wizard
// groups fields into sections at the UI layer only — see
// `components/case/IntakeWizard.tsx`.
export const BeneficiaryDataSchema = z
  .object({
    // Profile section
    fullName: z.string().min(1).max(200),
    dateOfBirth: z.iso.date(), // ISO 8601 YYYY-MM-DD
    nationality: z.string().min(2).max(100),
    currentLocation: z.string().min(1).max(200),

    // Practice / field section
    occupation: z.string().min(1).max(200),
    field: z.string().min(1).max(200),
    yearsActive: z.number().int().min(0).max(80),

    // Filing target section. Recommenders moved out of beneficiary_data:
    // they now live in `case_recommenders` (one row per letter-writer)
    // and the count derives from that table — see `_context.ts` and
    // `IntakeWizard`'s Recommenders section. `.strict()` would reject
    // a legacy `recommendersCount` field on read; the rollout plan is a
    // full DB wipe before re-test, so no migration is needed.
    targetFilingDate: z.iso.date(),

    // Contact + narrative
    email: z.email(),
    notes: z.string().min(1).max(5000),
  })
  .partial()
  .strict();

export type BeneficiaryData = z.infer<typeof BeneficiaryDataSchema>;
