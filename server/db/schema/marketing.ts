import { sql } from "drizzle-orm";
import {
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { WaitlistDetails } from "./zod/waitlist-details";

/**
 * Pre-launch / waitlist signups. Captured from the marketing site (Stage 04).
 *
 * Doubles as the **invite allowlist** for sign-in. A waitlist row with
 * `approved_at` set is the sole gate that lets a new email complete OAuth
 * sign-in (see `server/auth/invite-gate.ts`). Approval is a one-click
 * admin action from `/admin/waitlist`.
 *
 * GDPR/CCPA delete handling for Phase 1: manual SQL via admin, logged in
 * `audit_log` (see open_issues #1.13). Self-serve unsubscribe is a Phase 2
 * problem.
 */
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(), // citext via manual migration
    name: text("name"),
    source: text("source"), // free-text origin tag
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    referrer: text("referrer"),
    ipAddress: inet("ip_address"),

    // Submission funnel: `general` = "join the waitlist" (email + name only);
    // `attorney` = "apply for partnership" (carries structured firm/bar info
    // in `details`). Plain text + Zod-at-boundary instead of pg_enum: cheap
    // to add a third funnel later without an ALTER TYPE.
    kind: text("kind").notNull().default("general"),

    // Funnel-specific structured payload. Shape lives in
    // `schema/zod/waitlist-details.ts` so the column type stays honest.
    details: jsonb("details").$type<WaitlistDetails>(),

    // Invite gate. `approved_at IS NULL` = on the waitlist but not yet
    // permitted to sign in. Set by admin via `approveWaitlistEntry`.
    // `approved_by` references the admin who approved; nullable so we can
    // forward-fill via SQL during founder bootstrap.
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"), // FK added in migration to avoid circular import

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_entries_email_active_uniq")
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
    // Admin "newest signups" listing.
    index("waitlist_entries_created_idx").on(t.createdAt),
    // Sign-in invite-gate lookup. Partial index keeps it tiny — only
    // approved, non-deleted rows. Hot path: every new-user OAuth callback.
    index("waitlist_entries_email_approved_idx")
      .on(t.email)
      .where(sql`${t.approvedAt} is not null and ${t.deletedAt} is null`),
  ],
);
