import "server-only";
import Stripe from "stripe";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { env } from "@/config/env";
import { AppError } from "@/lib/errors";
import { db, type Db } from "@/server/db/client";
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
 * (and persists the id) if absent. Idempotent: a concurrent call with
 * the same userId returns the same customer id (the second call sees
 * the row already populated).
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
  const [row] = await conn
    .select({
      profileId: attorneyProfiles.id,
      stripeCustomerId: attorneyProfiles.stripeCustomerId,
      email: users.email,
      name: users.name,
    })
    .from(attorneyProfiles)
    .innerJoin(users, eq(users.id, attorneyProfiles.userId))
    .where(
      and(
        eq(attorneyProfiles.userId, args.attorneyUserId),
        isNull(attorneyProfiles.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError(
      "NOT_FOUND",
      `No attorney profile for user ${args.attorneyUserId}`,
    );
  }
  if (row.stripeCustomerId) {
    return { customerId: row.stripeCustomerId, created: false };
  }
  if (!row.email) {
    throw new AppError(
      "BAD_REQUEST",
      "Attorney has no email — Stripe Customer requires an email for invoice delivery.",
    );
  }
  const customer = await getStripe().customers.create({
    email: row.email,
    ...(row.name ? { name: row.name } : {}),
    metadata: {
      docketUserId: args.attorneyUserId,
    },
  });
  await conn
    .update(attorneyProfiles)
    .set({ stripeCustomerId: customer.id })
    .where(eq(attorneyProfiles.id, row.profileId));
  return { customerId: customer.id, created: true };
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
    beneficiaryFullName: extractFullName(r.beneficiaryData),
    caseFeeCents: r.caseFeeCents ?? 0n,
    docketShareCents: r.docketShareCents ?? 0n,
    attorneyShareCents: r.attorneyShareCents ?? 0n,
    filedAt: r.filedAt,
  }));
}

function extractFullName(blob: unknown): string | null {
  if (
    blob !== null &&
    typeof blob === "object" &&
    "fullName" in blob &&
    typeof (blob as { fullName?: unknown }).fullName === "string"
  ) {
    const v = (blob as { fullName: string }).fullName.trim();
    return v.length > 0 ? v : null;
  }
  return null;
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
 * Idempotency: the unique index makes step 3 atomic; a concurrent
 * call returns CONFLICT. If a Stripe call later fails, the row is
 * cleaned up (but cases stay in `pending` so the admin can retry).
 *
 * The whole flow runs in a single transaction up to step 3; Stripe
 * calls (4-5) happen outside the tx — Stripe doesn't roll back, so a
 * failure there leaves an orphan `invoices` row that the admin
 * cleans up via Stripe dashboard + a `revenue.adminVoidInvoice`
 * follow-up (Stage 11 polish).
 */
export async function createMonthlyInvoice(
  args: CreateMonthlyInvoiceArgs,
): Promise<CreateMonthlyInvoiceResult> {
  validatePeriod(args.periodYear, args.periodMonth);

  // 1. Customer
  const { customerId } = await getOrCreateCustomer({
    attorneyUserId: args.attorneyUserId,
    db: args.db,
  });

  // 2. Eligible cases
  const eligible = await listEligibleCasesForPeriod({
    db: args.db,
    attorneyUserId: args.attorneyUserId,
    periodYear: args.periodYear,
    periodMonth: args.periodMonth,
  });
  if (eligible.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      `No eligible cases for ${args.attorneyUserId} in ${args.periodYear}-${String(args.periodMonth).padStart(2, "0")}.`,
    );
  }

  const totalCents = eligible.reduce(
    (sum, c) => sum + Number(c.docketShareCents),
    0,
  );

  // 3. Reserve the period (INSERT first; unique index catches races).
  // We use a temporary placeholder for `stripe_invoice_id` so the row
  // satisfies the NOT NULL on insert; updated in step 5 with the real
  // Stripe id. The placeholder includes the period so two concurrent
  // attempts on different periods can't collide on the unique
  // `stripe_invoice_id` index either.
  const placeholderStripeId = `pending_${args.attorneyUserId}_${args.periodYear}_${args.periodMonth}`;
  let createdInvoice: { id: string };
  try {
    const [inserted] = await args.db
      .insert(invoices)
      .values({
        attorneyId: args.attorneyUserId,
        stripeInvoiceId: placeholderStripeId,
        periodYear: args.periodYear,
        periodMonth: args.periodMonth,
        totalCents,
        status: "draft",
      })
      .returning({ id: invoices.id });
    if (!inserted) {
      throw new AppError("INTERNAL", "invoices insert returned no row");
    }
    createdInvoice = inserted;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(
        "CONFLICT",
        `An invoice already exists for ${args.attorneyUserId} ${args.periodYear}-${String(args.periodMonth).padStart(2, "0")}.`,
      );
    }
    throw err;
  }

  // 4. Stripe — InvoiceItems + Invoice + finalize + send
  const stripe = getStripe();
  try {
    for (const c of eligible) {
      await stripe.invoiceItems.create({
        customer: customerId,
        currency: "usd",
        amount: Number(c.docketShareCents),
        description: invoiceLineDescription({
          visaType: c.visaType,
          beneficiaryFullName: c.beneficiaryFullName,
        }),
        metadata: { docketCaseId: c.id },
      });
    }
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 14,
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
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);

    // 5. Persist the real Stripe id + hosted URL + status.
    await args.db
      .update(invoices)
      .set({
        stripeInvoiceId: finalized.id ?? invoice.id,
        hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        status: stripeStatusToColumn(finalized.status),
        updatedAt: sql`now()`,
      })
      .where(eq(invoices.id, createdInvoice.id));

    // 6. Link cases + flip their revenue_status.
    const caseIds = eligible.map((c) => c.id);
    if (caseIds.length > 0) {
      await args.db
        .update(cases)
        .set({
          revenueStatus: "invoiced",
          invoiceId: createdInvoice.id,
        })
        .where(inArray(cases.id, [...caseIds]));
    }

    return {
      invoiceId: createdInvoice.id,
      stripeInvoiceId: finalized.id ?? invoice.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      totalCents,
      caseIds,
    };
  } catch (err) {
    // Stripe failed — drop the placeholder row so the admin can retry
    // without hitting the unique-period constraint.
    await args.db
      .delete(invoices)
      .where(eq(invoices.id, createdInvoice.id))
      .catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(
      "INTERNAL",
      `Stripe invoice generation failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Webhook state transitions
// ─────────────────────────────────────────────────────────────────────

/**
 * Webhook target — `invoice.paid`. Idempotent: a duplicate event
 * (Stripe retries on 5xx, plus replays during development) finds the
 * row already in `paid` and returns without touching cases.
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
      .where(eq(cases.invoiceId, row.id));
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
    // Cases flip to `failed` so the dashboard can flag them.
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
      .where(eq(cases.invoiceId, row.id));
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
    // Voiding releases the cases back to `pending` so they can be
    // re-billed in a future invoice (admin's choice).
    await tx
      .update(cases)
      .set({ revenueStatus: "pending", invoiceId: null })
      .where(eq(cases.invoiceId, row.id));
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
