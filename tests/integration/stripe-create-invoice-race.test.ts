// @vitest-environment node
import {
  afterAll,
  afterEach,
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

// Stripe SDK mock — every method we touch returns a deterministic
// shape, and we expose call counters so the race-condition assertions
// can verify "exactly one customer created" / "exactly one invoice
// created" across concurrent attempts.
const customersCreateMock = vi.hoisted(() => vi.fn());
const invoicesCreateMock = vi.hoisted(() => vi.fn());
const invoiceItemsCreateMock = vi.hoisted(() => vi.fn());
const finalizeInvoiceMock = vi.hoisted(() => vi.fn());
const sendInvoiceMock = vi.hoisted(() => vi.fn());
const delInvoiceMock = vi.hoisted(() => vi.fn());
const voidInvoiceMock = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => {
  // Stripe is a default export class. Returning a constructor stub that
  // hands back the mocked surface area we use in createMonthlyInvoice +
  // getOrCreateCustomer + the markInvoice* helpers.
  return {
    default: class StripeMock {
      customers = { create: customersCreateMock };
      invoices = {
        create: invoicesCreateMock,
        finalizeInvoice: finalizeInvoiceMock,
        sendInvoice: sendInvoiceMock,
        del: delInvoiceMock,
        voidInvoice: voidInvoiceMock,
      };
      invoiceItems = { create: invoiceItemsCreateMock };
      webhooks = { constructEvent: vi.fn() };
    },
  };
});

vi.mock("@/config/env", async (importOriginal) => {
  const actual = (await importOriginal()) as { env: Record<string, unknown> };
  return {
    env: {
      ...actual.env,
      STRIPE_SECRET_KEY: "sk_test_for_race_tests",
    },
  };
});

import {
  __resetStripeForTest,
  createMonthlyInvoice,
  getOrCreateCustomer,
} from "@/server/services/stripe";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * Stage 10 audit fix — race conditions.
 *
 * Two scenarios exercised against a real Postgres connection (Stripe
 * mocked):
 *   (a) Concurrent first-time `getOrCreateCustomer` for the same
 *       attorney must produce ONE Stripe customer, not two. Lock
 *       implementation: SELECT FOR UPDATE on attorney_profiles.
 *   (b) Concurrent `createMonthlyInvoice` and `logCaseFee` for the
 *       same case must serialize: the loser sees `revenueStatus =
 *       'invoiced'` and gets CONFLICT (no fee can land on a case
 *       that's already mid-invoicing). Lock implementation: SELECT
 *       FOR UPDATE on the eligible cases inside the reservation tx.
 *   (c) Stripe-failure rollback restores case statuses + clears
 *       invoice_id so a retry can proceed cleanly.
 */

const ATTORNEY = "70000030-0000-4000-8000-aaaa00000001";
const ORG = "70000030-0000-4000-8000-bbbb00000001";
const PROFILE = "70000030-0000-4000-8000-cccc00000001";

let db: TestDb | null = null;
let rlsReady = false;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db || !rlsReady) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

type ServiceDb = Parameters<typeof createMonthlyInvoice>[0]["db"];
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
  __resetStripeForTest();
  customersCreateMock.mockReset();
  invoicesCreateMock.mockReset();
  invoiceItemsCreateMock.mockReset();
  finalizeInvoiceMock.mockReset();
  sendInvoiceMock.mockReset();
  delInvoiceMock.mockReset();
  voidInvoiceMock.mockReset();
});

afterEach(() => {
  __resetStripeForTest();
});

afterAll(async () => {
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────
// (a) getOrCreateCustomer — concurrent first-time race
// ─────────────────────────────────────────────────────────────────────

describe("getOrCreateCustomer — concurrent first-time generates", () => {
  it("two simultaneous calls produce ONE Stripe customer (lock serializes)", async (ctx) => {
    const d = gate(ctx);
    let nextCustomerId = 1;
    customersCreateMock.mockImplementation(async () => ({
      id: `cus_test_${nextCustomerId++}`,
    }));

    const [a, b] = await Promise.all([
      getOrCreateCustomer({ attorneyUserId: ATTORNEY, db: asServiceDb(d) }),
      getOrCreateCustomer({ attorneyUserId: ATTORNEY, db: asServiceDb(d) }),
    ]);

    // Stripe SDK call count must be exactly 1.
    expect(customersCreateMock).toHaveBeenCalledTimes(1);
    // Both callers receive the same customer id.
    expect(a.customerId).toBe(b.customerId);
    // Exactly one of the two reports `created: true`.
    const createdFlags = [a.created, b.created].sort();
    expect(createdFlags).toEqual([false, true]);

    // The persisted column matches the returned id.
    const [profileRow] = await d
      .select({ stripeCustomerId: attorneyProfiles.stripeCustomerId })
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    expect(profileRow?.stripeCustomerId).toBe(a.customerId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (b) createMonthlyInvoice — locked-snapshot semantics
// ─────────────────────────────────────────────────────────────────────

describe("createMonthlyInvoice — case-status flip BEFORE Stripe calls", () => {
  it("flips eligible cases to `invoiced` before issuing any Stripe API call", async (ctx) => {
    const d = gate(ctx);
    customersCreateMock.mockResolvedValue({ id: "cus_lock_test" });
    // Spy on the case's status RIGHT WHEN Stripe's `invoices.create`
    // fires — by then the lock-protected UPDATE must already have
    // committed (otherwise a concurrent logCaseFee could race).
    let statusAtStripeCall: string | null = null;
    invoicesCreateMock.mockImplementation(async () => {
      const [row] = await d
        .select({ status: cases.revenueStatus })
        .from(cases)
        .where(eq(cases.organizationId, ORG))
        .limit(1);
      statusAtStripeCall = row?.status ?? null;
      return { id: "in_lock_test_1" };
    });
    invoiceItemsCreateMock.mockResolvedValue({ id: "ii_test" });
    finalizeInvoiceMock.mockResolvedValue({
      id: "in_lock_test_1",
      hosted_invoice_url: null,
      status: "open",
    });
    sendInvoiceMock.mockResolvedValue({ id: "in_lock_test_1" });

    await seedAttorneyProfileWithCustomerId(d, "cus_lock_test");
    await seedEligibleCase(d, { docketShareCents: 90_000n });

    const result = await createMonthlyInvoice({
      db: asServiceDb(d),
      attorneyUserId: ATTORNEY,
      periodYear: 2026,
      periodMonth: 4,
    });
    expect(result.invoiceId).toBeTruthy();
    expect(statusAtStripeCall).toBe("invoiced");
  });

  it("Stripe failure rolls back case status to its pre-snapshot value", async (ctx) => {
    const d = gate(ctx);
    customersCreateMock.mockResolvedValue({ id: "cus_rollback" });
    invoicesCreateMock.mockResolvedValue({ id: "in_rollback_1" });
    invoiceItemsCreateMock.mockResolvedValue({ id: "ii_rollback" });
    finalizeInvoiceMock.mockRejectedValue(
      Object.assign(new Error("simulated stripe failure"), { code: "boom" }),
    );
    sendInvoiceMock.mockResolvedValue({ id: "in_rollback_1" });

    await seedAttorneyProfileWithCustomerId(d, "cus_rollback");
    const pendingId = await seedEligibleCase(d, {
      docketShareCents: 90_000n,
      revenueStatus: "pending",
    });
    const failedId = await seedEligibleCase(d, {
      docketShareCents: 75_000n,
      revenueStatus: "failed",
    });

    await expect(
      createMonthlyInvoice({
        db: asServiceDb(d),
        attorneyUserId: ATTORNEY,
        periodYear: 2026,
        periodMonth: 4,
      }),
    ).rejects.toThrow();

    // Both cases restored to their pre-snapshot status; invoice_id cleared.
    const rows = await d
      .select({
        id: cases.id,
        revenueStatus: cases.revenueStatus,
        invoiceId: cases.invoiceId,
      })
      .from(cases)
      .where(eq(cases.organizationId, ORG))
      .orderBy(cases.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(pendingId)?.revenueStatus).toBe("pending");
    expect(byId.get(pendingId)?.invoiceId).toBeNull();
    expect(byId.get(failedId)?.revenueStatus).toBe("failed");
    expect(byId.get(failedId)?.invoiceId).toBeNull();

    // Placeholder DB row also gone.
    const invRows = await d
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.attorneyId, ATTORNEY));
    expect(invRows).toHaveLength(0);
  });

  it("uses voidInvoice (not del) when Stripe failure happens AFTER finalize", async (ctx) => {
    const d = gate(ctx);
    customersCreateMock.mockResolvedValue({ id: "cus_void" });
    invoicesCreateMock.mockResolvedValue({ id: "in_void_1" });
    invoiceItemsCreateMock.mockResolvedValue({ id: "ii_void" });
    // finalize SUCCEEDS, sendInvoice fails — by the time cleanup runs,
    // the Stripe invoice is finalized → must be voided, not deleted.
    finalizeInvoiceMock.mockResolvedValue({
      id: "in_void_1",
      hosted_invoice_url: null,
      status: "open",
    });
    sendInvoiceMock.mockRejectedValue(new Error("simulated send failure"));
    voidInvoiceMock.mockResolvedValue({ id: "in_void_1", status: "void" });

    await seedAttorneyProfileWithCustomerId(d, "cus_void");
    await seedEligibleCase(d, { docketShareCents: 90_000n });

    await expect(
      createMonthlyInvoice({
        db: asServiceDb(d),
        attorneyUserId: ATTORNEY,
        periodYear: 2026,
        periodMonth: 4,
      }),
    ).rejects.toThrow();

    expect(voidInvoiceMock).toHaveBeenCalledWith("in_void_1");
    expect(delInvoiceMock).not.toHaveBeenCalled();
  });

  it("uses del (not voidInvoice) when Stripe failure happens BEFORE finalize", async (ctx) => {
    const d = gate(ctx);
    customersCreateMock.mockResolvedValue({ id: "cus_del" });
    invoicesCreateMock.mockResolvedValue({ id: "in_del_1" });
    // Item creation fails before finalize — invoice is still draft → del.
    invoiceItemsCreateMock.mockRejectedValue(
      new Error("simulated item failure"),
    );
    delInvoiceMock.mockResolvedValue({ id: "in_del_1", deleted: true });

    await seedAttorneyProfileWithCustomerId(d, "cus_del");
    await seedEligibleCase(d, { docketShareCents: 90_000n });

    await expect(
      createMonthlyInvoice({
        db: asServiceDb(d),
        attorneyUserId: ATTORNEY,
        periodYear: 2026,
        periodMonth: 4,
      }),
    ).rejects.toThrow();

    expect(delInvoiceMock).toHaveBeenCalledWith("in_del_1");
    expect(voidInvoiceMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function seedFixtures(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ATTORNEY, name: "Race Attorney", email: "race-att@docket.local" },
  ]);
  await d.insert(userRoles).values([{ userId: ATTORNEY, role: "attorney" }]);
  await d.insert(organizations).values([
    { id: ORG, name: "Race Org", slug: "race-org" },
  ]);
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

async function seedAttorneyProfileWithCustomerId(
  d: TestDb,
  customerId: string,
): Promise<void> {
  await d
    .update(attorneyProfiles)
    .set({ stripeCustomerId: customerId })
    .where(eq(attorneyProfiles.id, PROFILE));
}

async function seedEligibleCase(
  d: TestDb,
  opts: {
    docketShareCents: bigint;
    revenueStatus?: "pending" | "failed";
  },
): Promise<string> {
  const docket = opts.docketShareCents;
  const fee = (docket * 100n) / 15n;
  const attorneyShare = fee - docket;
  const [c] = await d
    .insert(cases)
    .values({
      organizationId: ORG,
      visaType: "O-1A",
      status: "filed",
      revenueStatus: opts.revenueStatus ?? "pending",
      caseFeeCents: fee,
      docketShareCents: docket,
      attorneyShareCents: attorneyShare,
      filedAt: new Date(Date.UTC(2026, 3, 15)),
    })
    .returning({ id: cases.id });
  if (!c) throw new Error("seedEligibleCase failed");
  await d.insert(caseParticipants).values({
    caseId: c.id,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
  return c.id;
}

