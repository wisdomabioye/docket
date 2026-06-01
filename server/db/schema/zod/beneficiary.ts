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
    // Current residence. Split from the legacy single-string
    // `currentLocation` so country is a code-backed enum (ISO 3166-1
    // alpha-2 display name from `lib/locations/countries.ts`) and the
    // city stays free-form. Prior dataset wipe between iterations per
    // the file-header convention — no migration shim shipped.
    currentCountry: safeName(100),
    currentCity: safeText(120),

    // Practice / field section
    occupation: safeText(200),
    field: safeText(200),
    yearsActive: z.number().int().min(0).max(80).optional(),

    // Filing target section. Recommenders moved out of beneficiary_data:
    // they now live in `case_recommenders` (one row per letter-writer)
    // and the count derives from that table — see `_context.ts` and
    // `IntakeWizard`'s Recommenders section. A legacy `recommendersCount`
    // (or `currentLocation`) on an old row trips `.strict()` on READ —
    // that's why reads go through `StoredBeneficiaryDataSchema` below,
    // which strips unknown keys instead of failing. See open_issues #69.
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

/**
 * Read-tolerant variant for parsing blobs already PERSISTED in
 * `cases.beneficiary_data`. Identical field set (derived via `.strip()`
 * — no duplication, same inferred type), but unknown keys are dropped
 * instead of failing the parse.
 *
 * Use this on every READ of stored data; use the strict
 * `BeneficiaryDataSchema` on every WRITE/input boundary (client patches)
 * where an unexpected key is a real validation error to reject.
 *
 * Why two schemas: a strict read silently fell back to `{}` when a row
 * carried a since-removed key (`currentLocation`, `recommendersCount`),
 * blanking the attorney's intake form and the email case label. Stripping
 * on read neutralizes the whole field-removal bug class, not just the two
 * known keys. See open_issues #69.
 */
export const StoredBeneficiaryDataSchema = BeneficiaryDataSchema.strip();
