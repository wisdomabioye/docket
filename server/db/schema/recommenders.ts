import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./auth";

/**
 * Per-case recommender records. One row per letter-writer the
 * attorney has confirmed for the case. Each row drives one
 * `recommendation_letter_template` fan-out in `case-build` and one
 * subgroup-keyed entry in `case_outputs` (`subgroupKey = recommender.id`).
 *
 * Forward-compat for Phase 2:
 *   - `recommenderUserId` (nullable) lands when recommenders sign in
 *     to upload their own letter; null in Phase 1 because the attorney
 *     captures everything on the recommender's behalf.
 *   - `email` is nullable in Phase 1 — required to *generate* a letter:
 *     no, required to *send* one to the recommender: yes (Phase 2).
 *   - `displayOrder` is the attorney's manual ordering (0-based).
 *     Drag-to-reorder writes new values; the list query orders by it.
 *
 * Soft-deleted via `deletedAt` per CLAUDE §6.8. The case-build query in
 * `_context.ts` filters on `deleted_at IS NULL` so a removed recommender
 * doesn't get a letter generated.
 */
export const caseRecommenders = pgTable(
  "case_recommenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),

    /** Stable order within the case (0-based). Reorder mutations
     *  rewrite the column for affected rows in one tx. */
    displayOrder: integer("display_order").notNull().default(0),

    /** Required identity fields — surface in the prompt + the
     *  recommendation letter's salutation. Length caps mirror
     *  `BeneficiaryDataSchema` neighbour fields. */
    fullName: text("full_name").notNull(),
    relationship: text("relationship").notNull(),

    /** Title + organisation as a single free-text line ("Director,
     *  MIT Media Lab"). Surfaces in the letter signature block. */
    titleOrg: text("title_org"),
    /** Recommender's email. Nullable in Phase 1; required for the
     *  Phase 2 send-to-recommender flow. */
    email: text("email"),
    /** Free-form attorney guidance for THIS recommender's letter
     *  ("emphasise the Nature paper", "they were her PhD advisor"). */
    guidance: text("guidance"),

    /** Phase 2 forward-compat: when the recommender signs in, this
     *  links the row to a real `users.id`. Nullable in Phase 1.
     *  No FK index in Phase 1 — single-column FK with set-null is
     *  cheap on writes and the column is rarely the lookup key. */
    recommenderUserId: uuid("recommender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Primary read path: list a case's active recommenders ordered.
    index("case_recommenders_case_idx")
      .on(t.caseId, t.displayOrder)
      .where(sql`${t.deletedAt} is null`),
    // Within an active case, a (full_name, deleted_at) composite would
    // catch double-adds. We keep the constraint minimal — attorneys
    // legitimately list recommenders with similar names; surface the
    // collision in the UI rather than the DB. The display_order
    // composite above is sufficient for ordered reads.
    uniqueIndex("case_recommenders_case_order_active_uniq")
      .on(t.caseId, t.displayOrder)
      .where(sql`${t.deletedAt} is null`),
  ],
);
