import { z } from "zod";
import { barNumberSchema, requiredSafeText } from "@/lib/validators";

/**
 * Schema for `waitlist_entries.details` (jsonb). Shape varies by
 * `waitlist_entries.kind`:
 *
 *   - `general` → row has no details (column is null).
 *   - `attorney` → row carries the structured partnership-application
 *     fields below. Validated at the marketing-router boundary on insert
 *     and at the admin-router boundary on read.
 *
 * `passthrough()` lets older rows survive future field additions without
 * a backfill — same convention as `audit-details.ts`.
 *
 * Free-text fields use the safe-text validator from
 * `lib/validators.ts` — admins read these in the dashboard and they
 * land in support email threads, so HTML/control-char payloads should
 * never reach this column.
 */
export const AttorneyApplicationDetailsSchema = z
  .object({
    firmName: requiredSafeText(200),
    // State of admission accepts either a state code ("CA") or full
    // name ("California") — safeText covers both. Not a closed enum
    // here because the waitlist is consumer-facing and we'd rather
    // collect free-form than reject a typo at the funnel top.
    stateOfAdmission: requiredSafeText(80),
    barNumber: barNumberSchema,
    ailaMember: z.boolean(),
    yearsPracticing: z.number().int().min(0).max(80).optional(),
    // `notes` is open prose — keep length cap only.
    notes: z.string().min(1).max(2000).optional(),
  })
  .passthrough();

export type AttorneyApplicationDetails = z.infer<
  typeof AttorneyApplicationDetailsSchema
>;

/**
 * Union of every funnel's `details` shape. Add a new branch when a new
 * `kind` is introduced. The union keeps the column type tight; the
 * router validates the matching branch at the boundary.
 */
export type WaitlistDetails = AttorneyApplicationDetails;

export const WaitlistKind = ["general", "attorney"] as const;
export type WaitlistKind = (typeof WaitlistKind)[number];
