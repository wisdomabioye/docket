import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Auth.js v5 + Drizzle adapter standard tables. The adapter reads these
 * column names; do not rename without consulting Auth.js docs.
 *
 * `users` carries the adapter's required columns (id, name, email,
 * email_verified, image) plus our business columns (role lives in a
 * separate `user_roles` junction; profile-specific data in
 * `attorney_profiles` etc.).
 *
 * The `email` partial unique index lets a soft-deleted user re-sign-up
 * with the same address.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email").notNull(), // citext via manual migration (open_issues #1.3)
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),

    // Business columns.
    timezone: text("timezone").notNull().default("UTC"),
    locale: text("locale").notNull().default("en-US"),

    // Soft delete + optimistic concurrency.
    rowRevision: integer("row_revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Email unique only among non-deleted users — see open_issues #1.2.
    uniqueIndex("users_email_active_uniq")
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Auth.js OAuth account linkage. Composite PK on (provider, provider_account_id)
 * is required by the adapter. Tokens are stored in plain text — relying on
 * Postgres at-rest encryption (see open_issues #1.16).
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (t) => [
    primaryKey({
      name: "accounts_provider_pk",
      columns: [t.provider, t.providerAccountId],
    }),
  ],
);

/** Auth.js DB-session row. Read on every authenticated request. */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

/**
 * Required by adapter. Empty in practice — we don't use email magic links
 * (SSO only) — but the table must exist for the adapter contract.
 */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "verification_tokens_pk",
      columns: [t.identifier, t.token],
    }),
  ],
);

