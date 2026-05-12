import { z } from "zod";

/**
 * Reusable Zod helpers for "safe" text inputs.
 *
 * Two flavors, both intended to keep prompt-poisoning payloads and
 * Markdown/HTML-control characters out of fields that get rendered
 * back into PDFs and AI prompts:
 *
 *  - `safeName(max)` — for name-class fields (full name, nationality).
 *    Unicode letters (`\p{L}`) + space, apostrophe, hyphen, period.
 *    Accepts: "O'Brien-Smith", "Jean-Pierre", "José García", "中村",
 *             "Müller", "St. John"
 *    Rejects: digits, `<`, `>`, `{`, `}`, `;`, `\`, backticks, all
 *             ASCII control chars (incl. newlines), and anything else.
 *
 *  - `safeText(max)` — for short descriptive fields (occupation,
 *    field of work, current location). Adds digits and common
 *    punctuation that legitimate user content needs. Still rejects
 *    the prompt-control surface above.
 *    Accepts: "Senior Director, R&D", "Software Engineer (ML)",
 *             "Stanford / Adjunct", "London, UK"
 *    Rejects: angle brackets, braces, semicolons, backslashes,
 *             backticks, control chars.
 *
 * Both return `.optional()` schemas — paired with `BeneficiaryDataSchema`
 * which is `.partial()` and must keep its "every field optional"
 * contract. Required-on-completion enforcement lives in a separate
 * `CompleteBeneficiaryDataSchema` (open_issues #62).
 *
 * Narrative fields (notes, guidance) stay free-form Zod `.string()` —
 * the rationale is in the consuming schema's comments.
 */

// Allowed character class — Unicode letters + a small punctuation
// set. Anchored to the whole string so a single bad char rejects the
// input. Whitespace is a literal space character only; `\s` would
// also match newlines and tabs, which break PDF rendering and let
// prompt-injection payloads sneak through as "line 1\nline 2: ignore
// previous instructions". `u` flag is required for `\p{L}` to match
// Unicode letter categories (Latin, CJK, Cyrillic, etc.).
const SAFE_NAME_RE = /^[\p{L} '\-.]+$/u;
const SAFE_TEXT_RE = /^[\p{L}\p{N} '\-.,()&/+]+$/u;

const SAFE_NAME_MESSAGE =
  "Use letters, spaces, hyphens, apostrophes, or periods only.";
const SAFE_TEXT_MESSAGE =
  "Use letters, numbers, spaces, and basic punctuation only (no <, >, {, }, ;, \\, or backticks).";

/**
 * Optional name-class field. Empty string is rejected (Zod `.regex()`
 * requires at least one allowed char) so callers should pass
 * `undefined` to indicate "unset" — not `""`. This matches the
 * existing optional-string convention in [[feedback_no_empty_string_optional]].
 */
export function safeName(max: number): z.ZodOptional<z.ZodString> {
  return z
    .string()
    .min(1)
    .max(max)
    .regex(SAFE_NAME_RE, SAFE_NAME_MESSAGE)
    .optional();
}

/**
 * Optional safe-text field. Same empty-string caveat as `safeName`.
 */
export function safeText(max: number): z.ZodOptional<z.ZodString> {
  return z
    .string()
    .min(1)
    .max(max)
    .regex(SAFE_TEXT_RE, SAFE_TEXT_MESSAGE)
    .optional();
}

/**
 * Required-string variant of {@link safeName}. Use this when the form
 * field has no optional contract (e.g. `recommender.fullName` is
 * NOT NULL in the DB). Pre-trims whitespace so the form's onChange
 * pad doesn't pass `"  Alice  "` through.
 */
export function requiredSafeName(max: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(SAFE_NAME_RE, SAFE_NAME_MESSAGE);
}

/**
 * Required-string variant of {@link safeText}.
 */
export function requiredSafeText(max: number): z.ZodString {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(SAFE_TEXT_RE, SAFE_TEXT_MESSAGE);
}

/**
 * Bar number / license-number validator. State bar number formats vary
 * (California: 6-digit, NY: alphanumeric, TX: 8-digit, etc.), so we
 * use a permissive but bounded shape: uppercase alphanumeric + hyphen,
 * 2-30 chars. Rejects spaces, slashes, and any prompt-control chars.
 * Caller is expected to uppercase before parsing if the form accepts
 * lowercase input.
 */
const BAR_NUMBER_RE = /^[A-Z0-9-]{2,30}$/;
export const barNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(
        BAR_NUMBER_RE,
        "Bar number must be 2–30 characters: letters, digits, or hyphens.",
      ),
  );

/**
 * US state, DC, and territory codes. Source: USPS state abbreviations
 * (50 states + DC + 5 inhabited territories). Used for attorney bar
 * admission. Closed enum so the admin filter and the form's <select>
 * stay in sync — no free-text "Calfironia" typos.
 */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
] as const;
export type UsStateCode = (typeof US_STATE_CODES)[number];
export const usStateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(US_STATE_CODES));
