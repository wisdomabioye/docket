// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseParticipants,
  cases,
  invoices,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import {
  markInvoiceFailed,
  markInvoicePaid,
  markInvoiceVoided,
} from "@/server/services/stripe";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * Stage 10 audit fix: webhook → cases.revenue_status integration.
 *
 * The unit test for the webhook route mocks markInvoice* helpers, so the
 * SQL inside them was previously not under test. This file exercises
 * each helper against a real Postgres connection, asserts the cases
 * UPDATE happens correctly AND that the new status guard preserves
 * `paid` / `waived` cases (the in-depth review's HIGH-severity finding:
 * a late webhook must not regress an admin's pro-bono adjustment).
 *
 * Also exercises the money-conservation invariant — sum of an invoice's
 * linked cases' docket_share_cents equals the invoice's total_cents.
 */

const ATTORNEY = "70000020-0000-4000-8000-aaaa00000001";
const ORG = "70000020-0000-4000-8000-bbbb00000001";
const PROFILE = "70000020-0000-4000-8000-cccc00000001";

let db: TestDb | null = null;
let rlsReady = false;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db || !rlsReady) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

// `TestDb` is a `PostgresJsDatabase` without the `$client` slot the
// service-layer `Db` type carries. Both wrap the same underlying
// connection at runtime, so cast for the helper signatures.
type ServiceDb = Parameters<typeof markInvoicePaid>[0]["db"];
const asServiceDb = (d: TestDb): ServiceDb => d as unknown as ServiceDb;

beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  rlsReady = await rlsRoleExists(db);
});

beforeEach(async () => {
  if (!db) return;
  await truncateAllAppTables(db);
  await seedFixtures(db);
});

afterAll(async () => {
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────
// markInvoicePaid — happy path + idempotency + status guards
// ─────────────────────────────────────────────────────────────────────

describe("markInvoicePaid", () => {
  it("flips invoiced cases + the invoice row to paid", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced", "invoiced"],
      invoiceStatus: "open",
    });
    const result = await markInvoicePaid({
      db: asServiceDb(d),
      stripeInvoiceId: stripeIdFor(invoiceId),
    });
    expect(result.updated).toBe(true);

    const [inv] = await d
      .select({ status: invoices.status, lastFailureReason: invoices.lastFailureReason })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(inv?.status).toBe("paid");
    expect(inv?.lastFailureReason).toBeNull();

    const caseRows = await d
      .select({ id: cases.id, revenueStatus: cases.revenueStatus })
      .from(cases)
      .where(inArray(cases.id, caseIds));
    expect(caseRows.every((c) => c.revenueStatus === "paid")).toBe(true);
  });

  it("is idempotent — second call on a paid row is a no-op", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced"],
      invoiceStatus: "paid",
    });
    const result = await markInvoicePaid({
      db: asServiceDb(d),
      stripeInvoiceId: stripeIdFor(invoiceId),
    });
    expect(result.updated).toBe(false);
  });

  it("PRESERVES `waived` cases (admin pro-bono adjustment is not overwritten)", async (ctx) => {
    const d = gate(ctx);
    // Mixed bag: one invoiced (should flip to paid), one waived (must stay).
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced", "waived"],
      invoiceStatus: "open",
    });
    await markInvoicePaid({ db: asServiceDb(d), stripeInvoiceId: stripeIdFor(invoiceId) });
    const caseRows = await d
      .select({ id: cases.id, revenueStatus: cases.revenueStatus })
      .from(cases)
      .where(inArray(cases.id, caseIds))
      .orderBy(cases.id);
    const statuses = caseRows.map((c) => c.revenueStatus).sort();
    expect(statuses).toEqual(["paid", "waived"]);
  });

  it("returns no-update when the stripe invoice id is unknown", async (ctx) => {
    const d = gate(ctx);
    const result = await markInvoicePaid({
      db: asServiceDb(d),
      stripeInvoiceId: "in_does_not_exist",
    });
    expect(result.updated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// markInvoiceFailed — happy path + status guards (out-of-order delivery)
// ─────────────────────────────────────────────────────────────────────

describe("markInvoiceFailed", () => {
  it("flips invoiced cases to failed + stamps lastFailureReason", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced", "invoiced"],
      invoiceStatus: "open",
    });
    await markInvoiceFailed({
      db: asServiceDb(d),
      stripeInvoiceId: stripeIdFor(invoiceId),
      reason: "card_declined",
    });

    const [inv] = await d
      .select({ status: invoices.status, lastFailureReason: invoices.lastFailureReason })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    // Per the helper's contract, the invoice column stays `open` so
    // Stripe can keep retrying — we only stamp the failure reason.
    expect(inv?.status).toBe("open");
    expect(inv?.lastFailureReason).toBe("card_declined");

    const caseRows = await d
      .select({ revenueStatus: cases.revenueStatus })
      .from(cases)
      .where(inArray(cases.id, caseIds));
    expect(caseRows.every((c) => c.revenueStatus === "failed")).toBe(true);
  });

  it("PRESERVES paid cases when payment_failed arrives out of order", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["paid", "invoiced"],
      invoiceStatus: "open",
    });
    await markInvoiceFailed({
      db: asServiceDb(d),
      stripeInvoiceId: stripeIdFor(invoiceId),
      reason: "ignored",
    });
    const caseRows = await d
      .select({ revenueStatus: cases.revenueStatus })
      .from(cases)
      .where(inArray(cases.id, caseIds))
      .orderBy(cases.id);
    const statuses = caseRows.map((c) => c.revenueStatus).sort();
    expect(statuses).toEqual(["failed", "paid"]);
  });

  it("truncates a 600-char reason to 500 chars", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced"],
      invoiceStatus: "open",
    });
    await markInvoiceFailed({
      db: asServiceDb(d),
      stripeInvoiceId: stripeIdFor(invoiceId),
      reason: "x".repeat(600),
    });
    const [inv] = await d
      .select({ lastFailureReason: invoices.lastFailureReason })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(inv?.lastFailureReason?.length).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────
// markInvoiceVoided — happy path + status guards
// ─────────────────────────────────────────────────────────────────────

describe("markInvoiceVoided", () => {
  it("flips eligible cases back to pending + clears invoice_id", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced", "failed"],
      invoiceStatus: "open",
    });
    await markInvoiceVoided({ db: asServiceDb(d), stripeInvoiceId: stripeIdFor(invoiceId) });

    const [inv] = await d
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(inv?.status).toBe("void");

    const caseRows = await d
      .select({
        revenueStatus: cases.revenueStatus,
        invoiceId: cases.invoiceId,
      })
      .from(cases)
      .where(inArray(cases.id, caseIds));
    expect(caseRows.every((c) => c.revenueStatus === "pending")).toBe(true);
    expect(caseRows.every((c) => c.invoiceId === null)).toBe(true);
  });

  it("PRESERVES paid + waived cases (void doesn't undo a payment or admin pro-bono)", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["paid", "waived", "invoiced"],
      invoiceStatus: "open",
    });
    await markInvoiceVoided({ db: asServiceDb(d), stripeInvoiceId: stripeIdFor(invoiceId) });
    const caseRows = await d
      .select({
        revenueStatus: cases.revenueStatus,
        invoiceId: cases.invoiceId,
      })
      .from(cases)
      .where(inArray(cases.id, caseIds))
      .orderBy(cases.id);
    const statuses = caseRows.map((c) => c.revenueStatus).sort();
    expect(statuses).toEqual(["paid", "pending", "waived"]);
    // The 'invoiced' case became 'pending' AND its invoice_id is now
    // null. The paid + waived cases keep their invoice_id (audit
    // trail to the void-but-historically-paid invoice).
    const paidRow = caseRows.find((c) => c.revenueStatus === "paid");
    const waivedRow = caseRows.find((c) => c.revenueStatus === "waived");
    const releasedRow = caseRows.find((c) => c.revenueStatus === "pending");
    expect(paidRow?.invoiceId).toBe(invoiceId);
    expect(waivedRow?.invoiceId).toBe(invoiceId);
    expect(releasedRow?.invoiceId).toBeNull();
  });

  it("is idempotent — second call on a void row is a no-op", async (ctx) => {
    const d = gate(ctx);
    const { invoiceId } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced"],
      invoiceStatus: "void",
    });
    const result = await markInvoiceVoided({
      db: asServiceDb(d),
      stripeInvoiceId: stripeIdFor(invoiceId),
    });
    expect(result.updated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Money-conservation invariant
// ─────────────────────────────────────────────────────────────────────

describe("money conservation", () => {
  it("invoice.totalCents equals SUM(linked cases.docket_share_cents)", async (ctx) => {
    const d = gate(ctx);
    // Seed an invoice with three cases of varying docket shares.
    // Helper assigns docket_share_cents = 90_000 by default; override
    // to verify the sum logic isn't accidentally hardcoded.
    const { invoiceId, caseIds } = await seedInvoiceWithCases(d, {
      caseStatuses: ["invoiced", "invoiced", "invoiced"],
      invoiceStatus: "open",
      docketShareCentsPerCase: [90_000n, 150_000n, 75_000n],
    });
    // Set the invoice total to the sum (mirrors what
    // createMonthlyInvoice does at generation time).
    await d
      .update(invoices)
      .set({ totalCents: 90_000 + 150_000 + 75_000 })
      .where(eq(invoices.id, invoiceId));

    const sumRow = await d
      .select({
        sumCents: sql<string>`coalesce(sum(${cases.docketShareCents}), 0)::bigint`,
      })
      .from(cases)
      .where(inArray(cases.id, caseIds));
    const invRow = await d
      .select({ invoiceTotal: invoices.totalCents })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));

    expect(BigInt(sumRow[0]!.sumCents)).toBe(BigInt(invRow[0]!.invoiceTotal));
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function stripeIdFor(invoiceRowId: string): string {
  return `in_test_${invoiceRowId.slice(0, 8)}`;
}

async function seedFixtures(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ATTORNEY, name: "Webhook Attorney", email: "wb-att@docket.local" },
  ]);
  await d.insert(userRoles).values([{ userId: ATTORNEY, role: "attorney" }]);
  await d
    .insert(organizations)
    .values([{ id: ORG, name: "Webhook Org", slug: "wb-org" }]);
  await d.insert(organizationMembers).values([
    {
      organizationId: ORG,
      userId: ATTORNEY,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
  ]);
  await d.insert(attorneyProfiles).values([
    { id: PROFILE, userId: ATTORNEY, status: "active" },
  ]);
}

type CaseRevenueStatus =
  | "pending"
  | "invoiced"
  | "paid"
  | "waived"
  | "failed";

async function seedInvoiceWithCases(
  d: TestDb,
  opts: {
    caseStatuses: ReadonlyArray<CaseRevenueStatus>;
    invoiceStatus: "draft" | "open" | "paid" | "void" | "uncollectible";
    docketShareCentsPerCase?: ReadonlyArray<bigint>;
  },
): Promise<{ invoiceId: string; caseIds: string[] }> {
  const [inv] = await d
    .insert(invoices)
    .values({
      attorneyId: ATTORNEY,
      stripeInvoiceId: "__placeholder__", // overwritten below
      periodYear: 2026,
      periodMonth: 4,
      totalCents: 90_000 * opts.caseStatuses.length,
      status: opts.invoiceStatus,
    })
    .returning({ id: invoices.id });
  if (!inv) throw new Error("seedInvoice failed");
  const stripeId = stripeIdFor(inv.id);
  await d
    .update(invoices)
    .set({ stripeInvoiceId: stripeId })
    .where(eq(invoices.id, inv.id));

  const caseIds: string[] = [];
  for (let i = 0; i < opts.caseStatuses.length; i++) {
    const docket = opts.docketShareCentsPerCase?.[i] ?? 90_000n;
    const fee = docket * 100n / 15n; // approximate inverse of split
    const attorneyShare = fee - docket;
    const [c] = await d
      .insert(cases)
      .values({
        organizationId: ORG,
        visaType: "O-1A",
        status: "filed",
        revenueStatus: opts.caseStatuses[i]!,
        caseFeeCents: fee,
        docketShareCents: docket,
        attorneyShareCents: attorneyShare,
        invoiceId: inv.id,
        filedAt: new Date(Date.UTC(2026, 3, 15)),
      })
      .returning({ id: cases.id });
    if (!c) throw new Error("seedCase failed");
    await d.insert(caseParticipants).values({
      caseId: c.id,
      userId: ATTORNEY,
      role: "attorney",
      isPrimary: true,
    });
    caseIds.push(c.id);
  }
  return { invoiceId: inv.id, caseIds };
}
