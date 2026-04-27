import { sql } from "drizzle-orm";
import {
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Pre-launch / waitlist signups. Captured from the marketing site (Stage 04).
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

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_entries_email_active_uniq")
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
  ],
);
