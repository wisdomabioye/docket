import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

/**
 * Stage 10 monthly invoicing. One row per (attorney, year, month).
 * Unique-key collision on (attorney_id, period_year, period_month) is
 * the safety net against double-generating an invoice for the same
 * period — service-layer `createMonthlyInvoice` checks first, the
 * unique index catches a race.
 *
 * `status` mirrors Stripe's invoice status (`draft|open|paid|void|
 * uncollectible`). `hosted_invoice_url` is the Stripe-hosted page the
 * attorney clicks to pay; saved on creation, never recomputed (Stripe
 * doesn't change the URL after open).
 *
 * `cases.invoice_id` (Stage 1) FKs back here; Stage 10's migration
 * adds the actual constraint.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attorneyId: uuid("attorney_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Stripe's invoice id (`in_...`). Webhook lookups happen by this. */
    stripeInvoiceId: text("stripe_invoice_id").notNull(),

    /** Calendar period — single source of truth for "what month this
     *  invoice covers". Year is 4-digit; month is 1-12. */
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),

    /** Sum of all line-item amounts, in cents. Computed at generation
     *  time from the eligible cases. Stripe's authoritative total may
     *  differ if the admin edits in the Stripe dashboard — webhook
     *  events update the saved status, NOT the total (which is the
     *  amount we billed when we created the invoice). */
    totalCents: integer("total_cents").notNull(),

    /** Mirrors Stripe's invoice status. Constrained to the 5 values
     *  Stripe Invoicing returns. */
    status: text("status").notNull(),

    /** Stripe-hosted invoice page; persisted so the attorney's
     *  /settings billing list can deep-link without a Stripe lookup
     *  per pageview. Populated on `finalizeInvoice`. */
    hostedInvoiceUrl: text("hosted_invoice_url"),

    /** Free-form last-error from a `payment_failed` webhook. Cleared
     *  on a subsequent `paid` event. */
    lastFailureReason: text("last_failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One invoice per (attorney, year, month). Unique catches a race
    // between two admin clicks for the same period.
    uniqueIndex("invoices_attorney_period_uniq").on(
      t.attorneyId,
      t.periodYear,
      t.periodMonth,
    ),
    // Stripe webhook lookups are by stripe_invoice_id only.
    uniqueIndex("invoices_stripe_id_uniq").on(t.stripeInvoiceId),
    // Admin "all invoices for attorney X, newest first".
    index("invoices_attorney_created_idx").on(t.attorneyId, t.createdAt),
    // Status filter on /admin/revenue.
    index("invoices_status_idx").on(t.status),
    // Stripe's invoice status enumeration enforced at the DB level —
    // catches a service-layer bug that would otherwise let a typo
    // ("Paid") corrupt the column.
    check(
      "invoices_status_check",
      sql`${t.status} IN ('draft','open','paid','void','uncollectible')`,
    ),
  ],
);
