import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { attorneyStatusEnum, userRoleEnum } from "./enums";
import { users } from "./auth";

/**
 * Junction table — a user can hold multiple global roles (attorney + admin
 * during a takeover; attorney + applicant when an attorney files for family).
 * Lookup is fast (composite PK is the access pattern).
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.role] }),
    // Reverse-lookup: "list every admin" / "list every attorney".
    index("user_roles_role_idx").on(t.role),
  ],
);

/**
 * Profile data specific to attorneys. One row per user with role 'attorney'.
 * Separated from `users` to keep the user record stable across role
 * transitions (an attorney could later also become an applicant).
 *
 * `barStates` is a Postgres array — query "attorneys admitted in NY" with
 * `'NY' = any(bar_states)`. GIN index added when search becomes a feature.
 *
 * `acceptedTermsVersion` lets us re-prompt on terms updates without forcing
 * a global logout.
 */
export const attorneyProfiles = pgTable(
  "attorney_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    barNumber: text("bar_number"),
    barStates: text("bar_states").array().notNull().default([]),

    status: attorneyStatusEnum("status").notNull().default("pending"),

    // Set when the attorney completes the onboarding form. Distinct from
    // `created_at` (auto-provisioned at first sign-in) so admin can see
    // who's actually waiting for activation vs. who just signed up but
    // hasn't filled out the form.
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    agreementSignedAt: timestamp("agreement_signed_at", { withTimezone: true }),
    agreementStoragePath: text("agreement_storage_path"),
    acceptedTermsVersion: text("accepted_terms_version"),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One profile per user (active). If we ever want history we move to
    // versioned profiles — for now, single row.
    uniqueIndex("attorney_profiles_user_uniq")
      .on(t.userId)
      .where(sql`${t.deletedAt} is null`),
    // Admin "list pending attorneys" query.
    index("attorney_profiles_status_idx")
      .on(t.status)
      .where(sql`${t.deletedAt} is null`),
  ],
);
