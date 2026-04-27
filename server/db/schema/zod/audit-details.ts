import { z } from "zod";

/**
 * Schema for `audit_log.details` and `case_events.details` (jsonb).
 * Linked into Drizzle via `.$type<AuditDetails>()` on both tables.
 *
 * `passthrough()` keeps unknown fields so older audit rows survive schema
 * additions. Action-specific fields land in Stage 09 (`withAudit()`).
 */
export const AuditDetailsSchema = z
  .object({
    reason: z.string().max(2000).optional(),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    diff: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type AuditDetails = z.infer<typeof AuditDetailsSchema>;
