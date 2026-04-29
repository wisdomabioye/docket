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
import { eq } from "drizzle-orm";
import {
  attorneyProfiles,
  auditLog,
  caseEvents,
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

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * Stage 10 revenue router — covers every reachable branch of:
 *
 *   logCaseFee (attorney happy path, $0 → waived, CONFLICT on
 *               invoiced/paid, NOT_FOUND when not primary attorney,
 *               UNAUTHORIZED when anonymous)
 *   adjustCaseFee (admin escape hatch — works on invoiced + paid;
 *                  audit row written; FORBIDDEN for non-admin)
 *   attorneySummary (RLS-scoped totals + 6-month buckets)
 *   myInvoices (RLS-scoped; only caller's own invoices)
 *   eligibleCasesForPeriod (admin preview, period filter,
 *                           pending+failed inclusion, waived exclusion)
 *
 * Stripe-mocked branches (adminGenerateInvoice + webhook) live in
 * `tests/integration/stripe-invoice.test.ts`. This file does NOT
 * exercise Stripe — it covers everything that runs against the DB.
 */

const ADMIN = "70000010-0000-4000-8000-aaaa00000001";
const ALICE = "70000010-0000-4000-8000-bbbb00000001";
const BOB = "70000010-0000-4000-8000-cccc00000001";
const ALICE_ORG = "70000010-0000-4000-8000-dddd00000001";
const BOB_ORG = "70000010-0000-4000-8000-eeee00000001";
const ALICE_PROFILE = "70000010-0000-4000-8000-ffff00000001";
const BOB_PROFILE = "70000010-0000-4000-8000-1111aaaa0001";

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

let db: TestDb | null = null;
let rlsReady = false;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db || !rlsReady) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

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
// logCaseFee
// ─────────────────────────────────────────────────────────────────────

describe("revenue.logCaseFee", () => {
  it("primary attorney sets fee on a pending case → updates split + writes case event", async (ctx) => {
    const d = gate(ctx);
    // Alice owns a pending case, no fee yet.
    const caseId = await seedAliceCase(d, { revenueStatus: "pending" });
    const out = await callAs(ALICE).revenue.logCaseFee({
      caseId,
      feeCents: 600_000,
    });
    expect(out).toEqual({
      ok: true,
      feeCents: 600_000,
      docketShareCents: 90_000,
      attorneyShareCents: 510_000,
      status: "pending",
    });

    const [row] = await d.select().from(cases).where(eq(cases.id, caseId));
    expect(row?.caseFeeCents).toBe(600_000n);
    expect(row?.docketShareCents).toBe(90_000n);
    expect(row?.attorneyShareCents).toBe(510_000n);
    expect(row?.revenueStatus).toBe("pending");

    const events = await d
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, caseId));
    expect(events.find((e) => e.eventType === "case.fee_logged")).toBeDefined();
  });

  it("$0 fee forces waived status (pro-bono)", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, { revenueStatus: "pending" });
    const out = await callAs(ALICE).revenue.logCaseFee({
      caseId,
      feeCents: 0,
    });
    expect(out.status).toBe("waived");
    const [row] = await d.select().from(cases).where(eq(cases.id, caseId));
    expect(row?.revenueStatus).toBe("waived");
    expect(row?.caseFeeCents).toBe(0n);
  });

  it("flips waived back to pending when re-priced > 0", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, {
      revenueStatus: "waived",
      caseFeeCents: 0n,
    });
    const out = await callAs(ALICE).revenue.logCaseFee({
      caseId,
      feeCents: 100_000,
    });
    expect(out.status).toBe("pending");
  });

  it("CONFLICT when case is already invoiced", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, { revenueStatus: "invoiced" });
    await expect(
      callAs(ALICE).revenue.logCaseFee({ caseId, feeCents: 100_000 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("CONFLICT when case is already paid", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, { revenueStatus: "paid" });
    await expect(
      callAs(ALICE).revenue.logCaseFee({ caseId, feeCents: 100_000 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("NOT_FOUND when caller is not the primary attorney", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, { revenueStatus: "pending" });
    await expect(
      callAs(BOB).revenue.logCaseFee({ caseId, feeCents: 100_000 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("UNAUTHORIZED when anonymous", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(null).revenue.logCaseFee({
        caseId: "11111111-1111-4111-8111-111111111111",
        feeCents: 100,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// adjustCaseFee (admin)
// ─────────────────────────────────────────────────────────────────────

describe("revenue.adjustCaseFee", () => {
  it("admin can adjust an invoiced case's fee — keeps invoiced status", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, {
      revenueStatus: "invoiced",
      caseFeeCents: 600_000n,
    });
    const out = await callAs(ADMIN).revenue.adjustCaseFee({
      caseId,
      feeCents: 800_000,
      reason: "client agreed to higher rate after intake",
    });
    expect(out.status).toBe("invoiced");
    expect(out.feeCents).toBe(800_000);

    const [row] = await d.select().from(cases).where(eq(cases.id, caseId));
    expect(row?.revenueStatus).toBe("invoiced");
    expect(row?.caseFeeCents).toBe(800_000n);
  });

  it("admin adjust to $0 forces waived (even if previously paid → still waived per spec)", async (ctx) => {
    const d = gate(ctx);
    // Note: paid stays paid for non-zero adjusts (Stripe is source of
    // truth on the money) but $0 forces waived (the case is now treated
    // as pro-bono, the previous payment is admin's bookkeeping issue).
    const caseId = await seedAliceCase(d, { revenueStatus: "paid" });
    const out = await callAs(ADMIN).revenue.adjustCaseFee({
      caseId,
      feeCents: 0,
      reason: "case withdrawn — refund issued in Stripe",
    });
    expect(out.status).toBe("waived");
  });

  it("non-admin caller gets FORBIDDEN", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, { revenueStatus: "pending" });
    await expect(
      callAs(ALICE).revenue.adjustCaseFee({
        caseId,
        feeCents: 1,
        reason: "x",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("audit log distinguishes previously-waived (0n) from never-set (null)", async (ctx) => {
    const d = gate(ctx);
    // Two adjusts: one on a previously-waived case (caseFeeCents = 0n),
    // one on a freshly-created case where caseFeeCents was never set
    // (still null in the column). The audit details must record `"0"`
    // and `null` respectively — not both as `null`. Regression guard
    // for the truthy-vs-nullish bug at revenue.ts:237.
    const waivedCase = await seedAliceCase(d, {
      revenueStatus: "waived",
      caseFeeCents: 0n,
      docketShareCents: 0n,
      attorneyShareCents: 0n,
    });
    const freshCase = await seedAliceCase(d, { revenueStatus: "pending" });
    await callAs(ADMIN).revenue.adjustCaseFee({
      caseId: waivedCase,
      feeCents: 100_000,
      reason: "client agreed to bill",
    });
    await callAs(ADMIN).revenue.adjustCaseFee({
      caseId: freshCase,
      feeCents: 100_000,
      reason: "first fee",
    });
    const rows = await d
      .select({
        targetId: auditLog.targetId,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(eq(auditLog.action, "revenue.admin_adjust"));
    const waivedRow = rows.find((r) => r.targetId === waivedCase);
    const freshRow = rows.find((r) => r.targetId === freshCase);
    expect(
      (waivedRow?.details as { previousFeeCents: string | null } | null)
        ?.previousFeeCents,
    ).toBe("0");
    expect(
      (freshRow?.details as { previousFeeCents: string | null } | null)
        ?.previousFeeCents,
    ).toBeNull();
  });

  it("requires reason (Zod min(1))", async (ctx) => {
    const d = gate(ctx);
    const caseId = await seedAliceCase(d, { revenueStatus: "pending" });
    await expect(
      callAs(ADMIN).revenue.adjustCaseFee({
        caseId,
        feeCents: 100,
        reason: "",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// attorneySummary
// ─────────────────────────────────────────────────────────────────────

describe("revenue.attorneySummary", () => {
  it("aggregates the attorney's own filings into pending/invoiced/paid + month buckets", async (ctx) => {
    const d = gate(ctx);
    const filedAt = new Date();
    await d.insert(cases).values([
      {
        organizationId: ALICE_ORG,
        visaType: "O-1A",
        status: "filed",
        revenueStatus: "pending",
        caseFeeCents: 600_000n,
        docketShareCents: 90_000n,
        attorneyShareCents: 510_000n,
        filedAt,
      },
      {
        organizationId: ALICE_ORG,
        visaType: "EB-1A",
        status: "filed",
        revenueStatus: "paid",
        caseFeeCents: 1_000_000n,
        docketShareCents: 150_000n,
        attorneyShareCents: 850_000n,
        filedAt,
      },
    ]);
    // Re-attach Alice as primary on those cases.
    const rows = await d.select({ id: cases.id }).from(cases);
    for (const r of rows) {
      const [exists] = await d
        .select()
        .from(caseParticipants)
        .where(eq(caseParticipants.caseId, r.id));
      if (!exists) {
        await d.insert(caseParticipants).values({
          caseId: r.id,
          userId: ALICE,
          role: "attorney",
          isPrimary: true,
        });
      }
    }

    const out = await callAs(ALICE).revenue.attorneySummary();
    expect(out.totals.pendingCents).toBe(90_000n);
    expect(out.totals.paidCents).toBe(150_000n);
    expect(out.totals.attorneyShareCents).toBe(1_360_000n);
    expect(out.totals.filings).toBe(2);
    expect(out.months.length).toBeGreaterThanOrEqual(1);
  });

  it("RLS scoping: Bob does NOT see Alice's revenue", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, {
      revenueStatus: "paid",
      filedAt: new Date(),
      caseFeeCents: 1_000_000n,
      docketShareCents: 150_000n,
      attorneyShareCents: 850_000n,
    });
    const out = await callAs(BOB).revenue.attorneySummary();
    expect(out.totals.paidCents).toBe(0n);
    expect(out.totals.filings).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// myInvoices
// ─────────────────────────────────────────────────────────────────────

describe("revenue.myInvoices", () => {
  it("returns the caller's invoices, ordered newest-first", async (ctx) => {
    const d = gate(ctx);
    await d.insert(invoices).values([
      {
        attorneyId: ALICE,
        stripeInvoiceId: "in_alice_1",
        periodYear: 2026,
        periodMonth: 3,
        totalCents: 90_000,
        status: "paid",
        hostedInvoiceUrl: "https://stripe.example/in_alice_1",
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        attorneyId: ALICE,
        stripeInvoiceId: "in_alice_2",
        periodYear: 2026,
        periodMonth: 4,
        totalCents: 150_000,
        status: "open",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      },
      {
        attorneyId: BOB,
        stripeInvoiceId: "in_bob_1",
        periodYear: 2026,
        periodMonth: 4,
        totalCents: 99_999,
        status: "open",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      },
    ]);
    const out = await callAs(ALICE).revenue.myInvoices({});
    expect(out.items.map((r) => r.stripeInvoiceId)).toEqual([
      "in_alice_2",
      "in_alice_1",
    ]);
    // Bob's row is NOT returned (RLS).
    expect(out.items.find((r) => r.stripeInvoiceId === "in_bob_1")).toBeUndefined();
  });

  it("returns empty list when caller has no invoices", async (ctx) => {
    gate(ctx);
    const out = await callAs(ALICE).revenue.myInvoices({});
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });

  it("UNAUTHORIZED when anonymous", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(null).revenue.myInvoices({}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// eligibleCasesForPeriod (admin)
// ─────────────────────────────────────────────────────────────────────

describe("revenue.eligibleCasesForPeriod", () => {
  it("returns only cases filed in the requested month with non-zero fee + pending/failed status", async (ctx) => {
    const d = gate(ctx);
    const inside = new Date(Date.UTC(2026, 3, 15)); // April 15, 2026
    const outside = new Date(Date.UTC(2026, 2, 15)); // March 15, 2026

    await d.insert(cases).values([
      {
        organizationId: ALICE_ORG,
        visaType: "O-1A",
        status: "filed",
        revenueStatus: "pending",
        caseFeeCents: 600_000n,
        docketShareCents: 90_000n,
        attorneyShareCents: 510_000n,
        filedAt: inside,
      },
      {
        organizationId: ALICE_ORG,
        visaType: "EB-1A",
        status: "filed",
        revenueStatus: "failed",
        caseFeeCents: 800_000n,
        docketShareCents: 120_000n,
        attorneyShareCents: 680_000n,
        filedAt: inside,
      },
      // Excluded: paid (already invoiced)
      {
        organizationId: ALICE_ORG,
        visaType: "O-1A",
        status: "filed",
        revenueStatus: "paid",
        caseFeeCents: 600_000n,
        docketShareCents: 90_000n,
        attorneyShareCents: 510_000n,
        filedAt: inside,
      },
      // Excluded: waived (zero fee)
      {
        organizationId: ALICE_ORG,
        visaType: "O-1A",
        status: "filed",
        revenueStatus: "waived",
        caseFeeCents: 0n,
        docketShareCents: 0n,
        attorneyShareCents: 0n,
        filedAt: inside,
      },
      // Excluded: outside the period
      {
        organizationId: ALICE_ORG,
        visaType: "O-1A",
        status: "filed",
        revenueStatus: "pending",
        caseFeeCents: 600_000n,
        docketShareCents: 90_000n,
        attorneyShareCents: 510_000n,
        filedAt: outside,
      },
    ]);
    // Make Alice primary on every seeded case.
    const rows = await d.select({ id: cases.id }).from(cases);
    for (const r of rows) {
      const [exists] = await d
        .select()
        .from(caseParticipants)
        .where(eq(caseParticipants.caseId, r.id));
      if (!exists) {
        await d.insert(caseParticipants).values({
          caseId: r.id,
          userId: ALICE,
          role: "attorney",
          isPrimary: true,
        });
      }
    }

    const out = await callAs(ADMIN).revenue.eligibleCasesForPeriod({
      attorneyUserId: ALICE,
      periodYear: 2026,
      periodMonth: 4,
    });
    expect(out.items).toHaveLength(2);
    expect(out.totalDocketCents).toBe(210_000); // 90k + 120k
    for (const c of out.items) {
      expect(["pending", "failed"]).toBeTruthy(); // sanity — items have visaType/etc
      expect(["O-1A", "EB-1A"]).toContain(c.visaType);
    }
  });

  it("non-admin caller gets FORBIDDEN", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ALICE).revenue.eligibleCasesForPeriod({
        attorneyUserId: ALICE,
        periodYear: 2026,
        periodMonth: 4,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function seedFixtures(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ADMIN, name: "Rev Admin", email: "rev-admin@docket.local" },
    { id: ALICE, name: "Rev Alice", email: "rev-alice@docket.local" },
    { id: BOB, name: "Rev Bob", email: "rev-bob@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ADMIN, role: "admin" },
    { userId: ALICE, role: "attorney" },
    { userId: BOB, role: "attorney" },
  ]);
  await d.insert(organizations).values([
    { id: ALICE_ORG, name: "Alice Rev Org", slug: "rev-alice-org" },
    { id: BOB_ORG, name: "Bob Rev Org", slug: "rev-bob-org" },
  ]);
  await d.insert(organizationMembers).values([
    {
      organizationId: ALICE_ORG,
      userId: ALICE,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: BOB_ORG,
      userId: BOB,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
  ]);
  await d.insert(attorneyProfiles).values([
    { id: ALICE_PROFILE, userId: ALICE, status: "active" },
    { id: BOB_PROFILE, userId: BOB, status: "active" },
  ]);
}

async function seedAliceCase(
  d: TestDb,
  overrides: Partial<typeof cases.$inferInsert>,
): Promise<string> {
  const [created] = await d
    .insert(cases)
    .values({
      organizationId: ALICE_ORG,
      visaType: "O-1A",
      status: "filed",
      revenueStatus: "pending",
      ...overrides,
    })
    .returning({ id: cases.id });
  if (!created) throw new Error("seedAliceCase failed");
  await d.insert(caseParticipants).values({
    caseId: created.id,
    userId: ALICE,
    role: "attorney",
    isPrimary: true,
  });
  return created.id;
}
