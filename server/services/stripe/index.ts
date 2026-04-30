import "server-only";
import Stripe from "stripe";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { env } from "@/config/env";
import { AppError } from "@/lib/errors";
import { db, type Db } from "@/server/db/client";
import { extractBeneficiaryFullName } from "@/server/db/helpers";
import {
  attorneyProfiles,
  cases,
  invoices,
  users,
} from "@/server/db/schema";
import { invoiceLineDescription } from "./split";

/**
 * Stage 10 Stripe wrapper. The SDK is the boundary; every call to
 * Stripe goes through this module so:
 *   - Tests can `vi.mock("stripe", ...)` once and exercise every
 *     procedure without hitting the network.
 *   - `STRIPE_SECRET_KEY` absence is detected once at construction
 *     time (singleton lazily built; `getStripe()` throws a typed
 *     `AppError("PRECONDITION_FAILED")` when the key is missing).
 *   - The 15/85 split is computed in one place via `computeRevenueSplit`
 *     (see `./split`) — the service layer never reaches into Stripe
 *     to do money math.
 *
 * Money: amounts are integers in USD cents end-to-end. Currency is
 * locked to "usd" (spec §15.5 — multi-currency is post-beta).
 */

/** Pin to a specific Stripe API version so a Stripe-side default
 *  upgrade can't silently change response shapes. The Stripe SDK
 *  types `apiVersion` as the literal of its bundled API version (TS
 *  picks `"2026-04-22.dahlia"` from this SDK's d.ts). Cast through
 *  `as never` so we can pin to a deliberate older version without
 *  chasing the literal type on every SDK upgrade — the Stripe runtime
 *  accepts any valid version string. */
const STRIPE_API_VERSION = "2025-09-30.clover" as never;

let cached: Stripe | null = null;

/** Lazy Stripe singleton. Throws when `STRIPE_SECRET_KEY` is unset
 *  rather than constructing a client with `""` — Stripe's SDK accepts
 *  empty strings and fails on first request, which is harder to debug
 *  than a startup-time error. */
export function getStripe(): Stripe {
  if (cached) return cached;
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      "INTERNAL",
      "Stripe is not configured: STRIPE_SECRET_KEY is unset.",
    );
  }
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    // Custom app id (visible in Stripe events): Stripe recommends this
    // for white-labelled platforms.
    appInfo: {
      name: "Docket",
      version: "0.1.0",
    },
  });
  return cached;
}

/** Test-only — clears the singleton so a test can swap env state. */
export function __resetStripeForTest(): void {
  cached = null;
}

// ─────────────────────────────────────────────────────────────────────
// Customer
// ─────────────────────────────────────────────────────────────────────

/**
 * Read the attorney's saved Stripe Customer id. Creates one in Stripe
 * (and persists the id) if absent. Idempotent under concurrency: the
 * read holds a row-level lock on attorney_profiles for the duration
 * of the customer-create + UPDATE, so two simultaneous first-time
 * generates serialize — the second call sees the freshly-written
 * customer id and skips Stripe entirely. Without the lock both calls
 * would create distinct Stripe customers and the losing UPDATE would
 * orphan one.
 *
 * Must run inside a transaction (the caller's `db` should be a `tx`
 * handle when concurrency-sensitive). When no `db` is supplied, opens
 * its own transaction off the owner pool.
 *
 * Surfaces `AppError("NOT_FOUND")` when the user has no attorney
 * profile, and `AppError("BAD_REQUEST")` when the user has no email
 * (Stripe requires one for invoice delivery).
 */
export async function getOrCreateCustomer(args: {
  attorneyUserId: string;
  /** Optional override db (for tests). Defaults to the owner client. */
  db?: Db;
}): Promise<{ customerId: string; created: boolean }> {
  const conn = args.db ?? db;
  return await conn.transaction(async (tx) => {
    const [profileRow] = await tx
      .select({
        profileId: attorneyProfiles.id,
        stripeCustomerId: attorneyProfiles.stripeCustomerId,
      })
      .from(attorneyProfiles)
      .where(
        and(
          eq(attorneyProfiles.userId, args.attorneyUserId),
          isNull(attorneyProfiles.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!profileRow) {
      throw new AppError(
        "NOT_FOUND",
        `No attorney profile for user ${args.attorneyUserId}`,
      );
    }
    if (profileRow.stripeCustomerId) {
      return { customerId: profileRow.stripeCustomerId, created: false };
    }

    // Email/name lookup is unlocked — users.email never mutates after
    // sign-up via SSO. Pulled here (after the lock) so we don't hold
    // the join's read while waiting for the lock.
    const [userRow] = await tx
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, args.attorneyUserId))
      .limit(1);
    if (!userRow?.email) {
      throw new AppError(
        "BAD_REQUEST",
        "Attorney has no email — Stripe Customer requires an email for invoice delivery.",
      );
    }

    const customer = await getStripe().customers.create({
      email: userRow.email,
      ...(userRow.name ? { name: userRow.name } : {}),
      metadata: {
        docketUserId: args.attorneyUserId,
      },
    });
    await tx
      .update(attorneyProfiles)
      .set({ stripeCustomerId: customer.id })
      .where(eq(attorneyProfiles.id, profileRow.profileId));
    return { customerId: customer.id, created: true };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Eligible cases
// ─────────────────────────────────────────────────────────────────────

export type EligibleCase = {
  id: string;
  visaType: string;
  beneficiaryFullName: string | null;
  caseFeeCents: bigint;
  docketShareCents: bigint;
  attorneyShareCents: bigint;
  filedAt: Date | null;
};

/**
 * Eligible-cases preview for `(attorney, year, month)`. Used by the
 * admin UI before clicking Generate, AND by `createMonthlyInvoice` as
 * the source-of-truth set of cases to bill.
 *
 * Eligibility: `revenue_status IN ('pending', 'failed')` AND a non-zero
 * `case_fee_cents` AND the case's primary attorney is the requested
 * user AND not soft-deleted AND `filedAt` falls inside the calendar
 * month (UTC). Pro-bono cases (`status = waived`, fee = 0) are
 * excluded — they don't get billed.
 *
 * Returns nothing for an attorney with zero eligible cases — the
 * caller decides how to surface that ("no eligible cases for this
 * period").
 */
export async function listEligibleCasesForPeriod(args: {
  db: Db;
  attorneyUserId: string;
  periodYear: number;
  periodMonth: number; // 1-12
}): Promise<EligibleCase[]> {
  validatePeriod(args.periodYear, args.periodMonth);
  const start = new Date(Date.UTC(args.periodYear, args.periodMonth - 1, 1));
  const end = new Date(Date.UTC(args.periodYear, args.periodMonth, 1));

  const rows = await args.db
    .select({
      id: cases.id,
      visaType: cases.visaType,
      beneficiaryData: cases.beneficiaryData,
      caseFeeCents: cases.caseFeeCents,
      docketShareCents: cases.docketShareCents,
      attorneyShareCents: cases.attorneyShareCents,
      filedAt: cases.filedAt,
    })
    .from(cases)
    .innerJoin(
      sql`${sql.raw('"case_participants"')}`,
      sql`${cases.id} = "case_participants"."case_id"
        AND "case_participants"."user_id" = ${args.attorneyUserId}
        AND "case_participants"."is_primary" = true
        AND "case_participants"."removed_at" IS NULL`,
    )
    .where(
      and(
        isNull(cases.deletedAt),
        inArray(cases.revenueStatus, ["pending", "failed"]),
        sql`${cases.caseFeeCents} > 0`,
        gte(cases.filedAt, start),
        lt(cases.filedAt, end),
      ),
    )
    .orderBy(cases.filedAt);

  return rows.map((r) => ({
    id: r.id,
    visaType: r.visaType,
    beneficiaryFullName: extractBeneficiaryFullName(r.beneficiaryData),
    caseFeeCents: r.caseFeeCents ?? 0n,
    docketShareCents: r.docketShareCents ?? 0n,
    attorneyShareCents: r.attorneyShareCents ?? 0n,
    filedAt: r.filedAt,
  }));
}

function validatePeriod(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2024 || year > 2100) {
    throw new AppError("BAD_REQUEST", `Invalid year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError("BAD_REQUEST", `Invalid month: ${month}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Monthly invoice — generate + state transitions
// ─────────────────────────────────────────────────────────────────────

export type CreateMonthlyInvoiceArgs = {
  db: Db;
  attorneyUserId: string;
  periodYear: number;
  periodMonth: number;
};

export type CreateMonthlyInvoiceResult = {
  invoiceId: string;
  stripeInvoiceId: string;
  hostedInvoiceUrl: string | null;
  totalCents: number;
  caseIds: ReadonlyArray<string>;
};

/**
 * Generate the monthly Stripe invoice for an attorney's eligible
 * cases. Returns the new `invoices` row + the `cases` ids it linked.
 *
 * Flow (spec §15 + §15.5):
 *   1. Resolve / create the Stripe Customer for this attorney.
 *   2. List eligible cases for the period; throw BAD_REQUEST when empty.
 *   3. Reserve the period: insert `invoices` row first (UNIQUE on
 *      `(attorney, year, month)` blocks duplicates atomically). Use a
 *      placeholder `stripe_invoice_id` until Stripe returns the real id.
 *   4. Create one `InvoiceItem` per case under the customer, then
 *      create the `Invoice`, finalize, and send.
 *   5. Update the `invoices` row with the real Stripe id, hosted URL,
 *      total, and Stripe's status.
 *   6. Update each case's `revenue_status = invoiced` and `invoice_id`.
 *
 * Concurrency model. Two simultaneous writers we have to defend against:
 *   (a) two `adminGenerateInvoice` clicks for the same (attorney, year,
 *       month) — the partial unique index on `(attorney_id, year, month)
 *       WHERE deleted_at IS NULL` makes the second insert raise 23505,
 *       which we translate to CONFLICT.
 *   (b) `logCaseFee` updating a case's fee while we're mid-flight —
 *       resolved by SELECT FOR UPDATE on the eligible cases inside the
 *       reservation transaction below, AND by flipping the cases to
 *       `revenue_status = 'invoiced'` BEFORE releasing the lock. After
 *       commit, a concurrent `logCaseFee` sees `invoiced` and returns
 *       CONFLICT — its read happens through a separate transaction and
 *       blocks on the lock until ours commits.
 *
 * Stripe failure rollback. If Stripe rejects (network, validation, etc.)
 * after we've already flipped cases to `invoiced`, the catch path
 * restores each case to its pre-snapshot status (`pending` or `failed`)
 * and clears the `invoice_id`, then deletes the placeholder DB row so
 * the period-unique index frees up. Stripe-side: if the invoice was
 * still draft, `invoices.del` cascades through attached items; if we
 * had progressed to finalize, `del` fails and we fall back to
 * `voidInvoice` (the only legal teardown post-finalize).
 */
export async function createMonthlyInvoice(
  args: CreateMonthlyInvoiceArgs,
): Promise<CreateMonthlyInvoiceResult> {
  validatePeriod(args.periodYear, args.periodMonth);

  // 1. Customer (own internal lock — concurrent first-time generates
  // serialize and resolve to a single Stripe customer).
  const { customerId } = await getOrCreateCustomer({
    attorneyUserId: args.attorneyUserId,
    db: args.db,
  });

  // 2+3. Reserve the period AND lock the eligible cases in one tx.
  // Holding the lock through the case-status flip means a concurrent
  // `logCaseFee` blocks on its row read; once we commit, it sees
  // `revenue_status = 'invoiced'` and returns CONFLICT. The Stripe
  // calls in step 4 happen AFTER the tx commits — locks released —
  // so a slow Stripe response can't block other writers.
  const placeholderStripeId = `pending_${args.attorneyUserId}_${args.periodYear}_${args.periodMonth}`;
  let createdInvoice: { id: string };
  let snapshot: ReadonlyArray<{
    id: string;
    visaType: string;
    beneficiaryFullName: string | null;
    docketShareCents: bigint;
    previousStatus: "pending" | "failed";
  }>;
  let totalCents: number;
  try {
    const tx0 = await args.db.transaction(async (tx) => {
      const start = new Date(Date.UTC(args.periodYear, args.periodMonth - 1, 1));
      const end = new Date(Date.UTC(args.periodYear, args.periodMonth, 1));
      const lockedRows = await tx
        .select({
          id: cases.id,
          visaType: cases.visaType,
          beneficiaryData: cases.beneficiaryData,
          docketShareCents: cases.docketShareCents,
          revenueStatus: cases.revenueStatus,
        })
        .from(cases)
        .innerJoin(
          sql`${sql.raw('"case_participants"')}`,
          sql`${cases.id} = "case_participants"."case_id"
            AND "case_participants"."user_id" = ${args.attorneyUserId}
            AND "case_participants"."is_primary" = true
            AND "case_participants"."removed_at" IS NULL`,
        )
        .where(
          and(
            isNull(cases.deletedAt),
            inArray(cases.revenueStatus, ["pending", "failed"]),
            sql`${cases.caseFeeCents} > 0`,
            gte(cases.filedAt, start),
            lt(cases.filedAt, end),
          ),
        )
        .orderBy(cases.id)
        .for("update");

      if (lockedRows.length === 0) {
        throw new AppError(
          "BAD_REQUEST",
          `No eligible cases for ${args.attorneyUserId} in ${args.periodYear}-${String(args.periodMonth).padStart(2, "0")}.`,
        );
      }

      const snap = lockedRows.map((r) => ({
        id: r.id,
        visaType: r.visaType,
        beneficiaryFullName: extractBeneficiaryFullName(r.beneficiaryData),
        docketShareCents: r.docketShareCents ?? 0n,
        // Narrowed by the inArray filter above. The cast localizes
        // the runtime invariant to one place.
        previousStatus: r.revenueStatus as "pending" | "failed",
      }));
      const total = snap.reduce(
        (sum, c) => sum + Number(c.docketShareCents),
        0,
      );

      let inserted: { id: string } | undefined;
      try {
        [inserted] = await tx
          .insert(invoices)
          .values({
            attorneyId: args.attorneyUserId,
            stripeInvoiceId: placeholderStripeId,
            periodYear: args.periodYear,
            periodMonth: args.periodMonth,
            totalCents: total,
            status: "draft",
          })
          .returning({ id: invoices.id });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(
            "CONFLICT",
            `An invoice already exists for ${args.attorneyUserId} ${args.periodYear}-${String(args.periodMonth).padStart(2, "0")}.`,
          );
        }
        throw err;
      }
      if (!inserted) {
        throw new AppError("INTERNAL", "invoices insert returned no row");
      }

      // Flip the locked cases to `invoiced` + attach the invoice id
      // BEFORE releasing the lock. Concurrent `logCaseFee` reads will
      // see `invoiced` after commit and CONFLICT.
      await tx
        .update(cases)
        .set({
          revenueStatus: "invoiced",
          invoiceId: inserted.id,
        })
        .where(
          inArray(
            cases.id,
            snap.map((c) => c.id),
          ),
        );

      return { invoiceId: inserted.id, snap, totalCents: total };
    });
    createdInvoice = { id: tx0.invoiceId };
    snapshot = tx0.snap;
    totalCents = tx0.totalCents;
  } catch (err) {
    // Reservation failed before any Stripe contact. Errors here are
    // already AppError-shaped (BAD_REQUEST / CONFLICT / INTERNAL).
    if (err instanceof AppError) throw err;
    throw new AppError(
      "INTERNAL",
      `Invoice reservation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // 4. Stripe — Invoice (empty draft) → attached InvoiceItems → finalize → send.
  // Order matters: creating items WITH `invoice: invoice.id` makes Stripe
  // own them. A partial failure is recoverable by deleting the draft
  // invoice (Stripe cascades to attached items). Floating items on the
  // customer would survive cleanup and pollute the next retry.
  const stripe = getStripe();
  let stripeInvoiceIdToCleanup: string | null = null;
  let stripeInvoiceFinalized = false;
  try {
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 14,
      // Don't auto-pull any pre-existing floating items on this customer —
      // we attach the items we want explicitly below.
      pending_invoice_items_behavior: "exclude",
      metadata: {
        docketAttorneyId: args.attorneyUserId,
        periodYear: String(args.periodYear),
        periodMonth: String(args.periodMonth),
        invoicesRowId: createdInvoice.id,
      },
    });
    if (!invoice.id) {
      throw new AppError("INTERNAL", "Stripe invoice missing id");
    }
    stripeInvoiceIdToCleanup = invoice.id;

    for (const c of snapshot) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        currency: "usd",
        amount: Number(c.docketShareCents),
        description: invoiceLineDescription({
          visaType: c.visaType,
          beneficiaryFullName: c.beneficiaryFullName,
        }),
        metadata: { docketCaseId: c.id },
      });
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    stripeInvoiceFinalized = true;
    await stripe.invoices.sendInvoice(invoice.id);

    // 5. Persist the real Stripe id + status. Cases were already
    // flipped to `invoiced` in step 2+3, so this is a single UPDATE
    // on the `invoices` row (no longer needs a multi-statement tx).
    await args.db
      .update(invoices)
      .set({
        stripeInvoiceId: finalized.id ?? invoice.id,
        hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        status: stripeStatusToColumn(finalized.status),
        updatedAt: sql`now()`,
      })
      .where(eq(invoices.id, createdInvoice.id));

    return {
      invoiceId: createdInvoice.id,
      stripeInvoiceId: finalized.id ?? invoice.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      totalCents,
      caseIds: snapshot.map((c) => c.id),
    };
  } catch (err) {
    // Stripe failed mid-flight. Cleanup must:
    //   1. Restore each case to its pre-snapshot status + clear invoiceId.
    //   2. Delete the placeholder DB row (frees the unique-period index).
    //   3. Tear down whatever we created on Stripe's side. `del` works on
    //      drafts; finalized invoices require `voidInvoice` instead.
    // Each step is best-effort and tolerates its own failure; the
    // original error is what we ultimately surface to the caller.
    await rollbackCaseStatuses(args.db, createdInvoice.id, snapshot).catch(
      () => undefined,
    );
    await args.db
      .delete(invoices)
      .where(eq(invoices.id, createdInvoice.id))
      .catch(() => undefined);
    if (stripeInvoiceIdToCleanup) {
      if (stripeInvoiceFinalized) {
        await stripe.invoices
          .voidInvoice(stripeInvoiceIdToCleanup)
          .catch(() => undefined);
      } else {
        await stripe.invoices
          .del(stripeInvoiceIdToCleanup)
          .catch(() => undefined);
      }
    }
    if (err instanceof AppError) throw err;
    throw new AppError(
      "INTERNAL",
      `Stripe invoice generation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/** Restore each case to its pre-reservation status + drop the invoice
 *  link. Used by `createMonthlyInvoice`'s catch path. Two passes (one
 *  per source status) keep this expressible without raw SQL CASE. */
async function rollbackCaseStatuses(
  conn: Db,
  invoiceId: string,
  snapshot: ReadonlyArray<{ id: string; previousStatus: "pending" | "failed" }>,
): Promise<void> {
  const pendingIds = snapshot
    .filter((c) => c.previousStatus === "pending")
    .map((c) => c.id);
  const failedIds = snapshot
    .filter((c) => c.previousStatus === "failed")
    .map((c) => c.id);
  await conn.transaction(async (tx) => {
    if (pendingIds.length > 0) {
      await tx
        .update(cases)
        .set({ revenueStatus: "pending", invoiceId: null })
        .where(
          and(
            inArray(cases.id, pendingIds),
            eq(cases.invoiceId, invoiceId),
          ),
        );
    }
    if (failedIds.length > 0) {
      await tx
        .update(cases)
        .set({ revenueStatus: "failed", invoiceId: null })
        .where(
          and(
            inArray(cases.id, failedIds),
            eq(cases.invoiceId, invoiceId),
          ),
        );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Webhook state transitions
// ─────────────────────────────────────────────────────────────────────

/**
 * The set of `cases.revenue_status` values a webhook is allowed to
 * transition. Two states are deliberately preserved by every handler:
 *   - `waived`: an admin pro-bono adjustment via `revenue.adjustCaseFee`
 *     after the case was invoiced. Ledger says "we won't bill this
 *     even though Stripe retains an invoice line for it." A late
 *     `invoice.paid` webhook would otherwise silently overwrite that
 *     decision (the audit-log entry from the admin would be orthogonal
 *     to the actual ledger state).
 *   - `paid`: defends against Stripe delivering events out of order
 *     (rare but not impossible). Once we've recorded payment for a
 *     case, no later webhook should regress it.
 *
 * Centralized so all three handlers stay in lockstep.
 */
const WEBHOOK_TRANSITIONABLE_STATUSES = ["pending", "invoiced", "failed"] as const;

/**
 * Webhook target — `invoice.paid`. Idempotent: a duplicate event
 * (Stripe retries on 5xx, plus replays during development) finds the
 * row already in `paid` and returns without touching cases. Status-
 * guarded on the cases UPDATE so an admin's prior `waived` adjustment
 * is preserved.
 */
export async function markInvoicePaid(args: {
  db: Db;
  stripeInvoiceId: string;
}): Promise<{ updated: boolean }> {
  return await args.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.stripeInvoiceId, args.stripeInvoiceId))
      .limit(1)
      .for("update");
    if (!row) return { updated: false };
    if (row.status === "paid") return { updated: false };
    await tx
      .update(invoices)
      .set({
        status: "paid",
        lastFailureReason: null,
        updatedAt: sql`now()`,
      })
      .where(eq(invoices.id, row.id));
    await tx
      .update(cases)
      .set({ revenueStatus: "paid" })
      .where(
        and(
          eq(cases.invoiceId, row.id),
          inArray(cases.revenueStatus, [...WEBHOOK_TRANSITIONABLE_STATUSES]),
        ),
      );
    return { updated: true };
  });
}

export async function markInvoiceFailed(args: {
  db: Db;
  stripeInvoiceId: string;
  reason: string;
}): Promise<{ updated: boolean }> {
  return await args.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.stripeInvoiceId, args.stripeInvoiceId))
      .limit(1)
      .for("update");
    if (!row) return { updated: false };
    // Stripe sends `payment_failed` on charge attempts; the invoice
    // stays `open` (Stripe will retry). We keep the column as `open`
    // and stamp `last_failure_reason` so the admin can see the error.
    // Cases flip to `failed` so the dashboard can flag them — but only
    // when they were in a transitionable state. A late `payment_failed`
    // arriving after `invoice.paid` (out-of-order delivery) must not
    // regress a paid case; an admin's `waived` adjustment is preserved.
    await tx
      .update(invoices)
      .set({
        lastFailureReason: args.reason.slice(0, 500),
        updatedAt: sql`now()`,
      })
      .where(eq(invoices.id, row.id));
    await tx
      .update(cases)
      .set({ revenueStatus: "failed" })
      .where(
        and(
          eq(cases.invoiceId, row.id),
          inArray(cases.revenueStatus, [...WEBHOOK_TRANSITIONABLE_STATUSES]),
        ),
      );
    return { updated: true };
  });
}

export async function markInvoiceVoided(args: {
  db: Db;
  stripeInvoiceId: string;
}): Promise<{ updated: boolean }> {
  return await args.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.stripeInvoiceId, args.stripeInvoiceId))
      .limit(1)
      .for("update");
    if (!row) return { updated: false };
    if (row.status === "void") return { updated: false };
    await tx
      .update(invoices)
      .set({ status: "void", updatedAt: sql`now()` })
      .where(eq(invoices.id, row.id));
    // Voiding releases transitionable cases back to `pending` so they
    // can be re-billed in a future invoice (admin's choice). `paid`
    // and `waived` cases keep their state — voiding the invoice
    // doesn't undo a payment Stripe already collected, and shouldn't
    // overturn an admin's pro-bono mark.
    await tx
      .update(cases)
      .set({ revenueStatus: "pending", invoiceId: null })
      .where(
        and(
          eq(cases.invoiceId, row.id),
          inArray(cases.revenueStatus, [...WEBHOOK_TRANSITIONABLE_STATUSES]),
        ),
      );
    return { updated: true };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/** Maps Stripe's `Invoice.status` to our column's CHECK-allowed set.
 *  Stripe can return `null`/`undefined` on a freshly-created invoice
 *  before finalize — coerce to "draft" in that case. */
function stripeStatusToColumn(
  stripeStatus: Stripe.Invoice.Status | null | undefined,
): "draft" | "open" | "paid" | "void" | "uncollectible" {
  switch (stripeStatus) {
    case "draft":
    case "open":
    case "paid":
    case "void":
    case "uncollectible":
      return stripeStatus;
    default:
      return "draft";
  }
}

/** Detect Postgres unique-violation (SQLSTATE 23505). The driver
 *  exposes the SQLSTATE on `err.code`; we accept either explicit
 *  postgres-js shape or a fallback substring on the message. */
function isUniqueViolation(err: unknown): boolean {
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  ) {
    return true;
  }
  if (
    err instanceof Error &&
    err.message.includes("invoices_attorney_period_uniq")
  ) {
    return true;
  }
  return false;
}

export {
  computeRevenueSplit,
  invoiceLineDescription,
  maskBeneficiaryName,
} from "./split";
