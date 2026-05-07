import { z } from "zod";

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
 */
export const AttorneyApplicationDetailsSchema = z
  .object({
    firmName: z.string().min(1).max(200),
    stateOfAdmission: z.string().min(2).max(80),
    barNumber: z.string().min(1).max(80),
    ailaMember: z.boolean(),
    yearsPracticing: z.number().int().min(0).max(80).optional(),
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
