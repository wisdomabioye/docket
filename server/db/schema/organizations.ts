import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { orgMemberRoleEnum, orgMemberStatusEnum } from "./enums";
import { users } from "./auth";

/**
 * Tenant boundary. In Phase 1 each solo attorney gets an auto-created org
 * on first sign-in (Stage 02 callback). Phase 2 multi-attorney firms add
 * seats and route billing here.
 *
 * `slug` is human-readable URL chunk; reserved-word blocking happens at the
 * application layer. `stripeCustomerId` lives here (not on `attorney_profiles`)
 * because billing is org-level — a firm pays one invoice for all attorneys.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    billingEmail: text("billing_email"),
    stripeCustomerId: text("stripe_customer_id"),

    rowRevision: integer("row_revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("organizations_slug_active_uniq")
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Membership join. Status carries invitation lifecycle so we don't need a
 * separate `org_invitations` table.
 *
 * `(organization_id, user_id)` is unique among non-removed rows — a user
 * can rejoin after being removed by creating a new row.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgMemberRoleEnum("role").notNull().default("member"),
    status: orgMemberStatusEnum("status").notNull().default("active"),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_members_org_user_active_uniq")
      .on(t.organizationId, t.userId)
      .where(sql`${t.removedAt} is null`),
  ],
);
