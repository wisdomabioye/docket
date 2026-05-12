import { z } from "zod";
import { safeName, safeText } from "@/lib/validators";

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
    // Profile section. Name-class fields use `safeName` (Unicode
    // letters + space/hyphen/apostrophe/period); descriptive fields
    // use `safeText` (also digits + comma/&/parens/slash). See
    // `lib/validators.ts` for the threat model — these reject
    // angle-bracket / brace / control-char payloads that would
    // otherwise round-trip into AI prompts and rendered PDFs.
    fullName: safeName(200),
    dateOfBirth: z.iso.date().optional(), // ISO 8601 YYYY-MM-DD
    nationality: safeName(100),
    currentLocation: safeText(200),

    // Practice / field section
    occupation: safeText(200),
    field: safeText(200),
    yearsActive: z.number().int().min(0).max(80).optional(),

    // Filing target section. Recommenders moved out of beneficiary_data:
    // they now live in `case_recommenders` (one row per letter-writer)
    // and the count derives from that table — see `_context.ts` and
    // `IntakeWizard`'s Recommenders section. `.strict()` would reject
    // a legacy `recommendersCount` field on read; the rollout plan is a
    // full DB wipe before re-test, so no migration is needed.
    targetFilingDate: z.iso.date().optional(),

    // Contact + narrative. `notes` stays free-form by design — it's
    // the attorney's working memo, not a structured field, and over-
    // sanitizing here would harm legitimate content (paragraph breaks,
    // bullet markers, quotes). Length cap is the only guard.
    email: z.email().optional(),
    notes: z.string().min(1).max(5000).optional(),
  })
  .strict();

export type BeneficiaryData = z.infer<typeof BeneficiaryDataSchema>;
