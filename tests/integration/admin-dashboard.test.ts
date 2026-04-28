// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  attorneyProfiles,
  auditLog,
  caseComputeLedger,
  caseParticipants,
  cases,
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
 * Stage 09 admin-dashboard procedures.
 *
 * Each suite covers: happy path, filter behavior, empty-state shape,
 * forbidden non-admin caller. Page rendering itself isn't unit-tested
 * because the RSC + tRPC server caller path is exercised by `pnpm build`
 * (page registration + type-checked queries) — adding a JSDOM render
 * harness here would duplicate that coverage without catching anything
 * new. open_issues #19 tracks integration page-render tests once we have
 * a Playwright setup.
 */

const ADMIN = "b0000000-0000-4000-8000-aaaa00000001";
const NON_ADMIN = "b0000000-0000-4000-8000-bbbb00000001";
const ATTORNEY_A = "b0000000-0000-4000-8000-cccc00000001";
const ATTORNEY_B = "b0000000-0000-4000-8000-dddd00000001";
const ORG_A = "b0000000-0000-4000-8000-eeee00000001";
const ORG_B = "b0000000-0000-4000-8000-ffff00000001";
const CASE_INTAKE = "b1000000-0000-4000-8000-aaaa00000001";
const CASE_DRAFT = "b1000000-0000-4000-8000-bbbb00000001";
const CASE_FILED = "b1000000-0000-4000-8000-cccc00000001";

const ALL_USER_IDS = [ADMIN, NON_ADMIN, ATTORNEY_A, ATTORNEY_B];
const ALL_ORG_IDS = [ORG_A, ORG_B];

let db: TestDb | null = null;
let rlsReady = false;

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

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
  if (!rlsReady) return;
});

beforeEach(async () => {
  if (!db) return;
  // Per-test isolation. The setup-level truncate runs once per file; tests
  // here mutate seeded rows (e.g. clearing `filed_at` on a case) so we
  // need a clean slate before re-seeding for each `it`.
  await truncateAllAppTables(db);
  await seedFixtures(db);
});

afterAll(async () => {
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────
// getOverviewMetrics
// ─────────────────────────────────────────────────────────────────────

describe("admin.getOverviewMetrics", () => {
  it("returns attorney + case + revenue counts in one shape", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.getOverviewMetrics();

    expect(out.attorneys.active).toBe(1);
    expect(out.attorneys.pending).toBe(1);
    expect(out.cases.total).toBe(3);
    expect(out.cases.byStatus.intake).toBe(1);
    expect(out.cases.byStatus.draft_ready).toBe(1);
    expect(out.cases.byStatus.filed).toBe(1);
    // Revenue 7d: filed case has fee 5000_00 and was filed today via seed
    expect(out.revenue7d.filings).toBe(1);
    expect(out.revenue7d.grossCents).toBe(500000n);
    expect(out.revenue7d.docketShareCents).toBe(75000n);
    expect(out.recentEvents.length).toBeLessThanOrEqual(10);
  });

  it("returns zero revenue when no cases are filed in window", async (ctx) => {
    const d = gate(ctx);
    await d.update(cases).set({ filedAt: null }).where(eq(cases.id, CASE_FILED));

    const out = await callAs(ADMIN).admin.getOverviewMetrics();
    expect(out.revenue7d.filings).toBe(0);
    expect(out.revenue7d.grossCents).toBe(0n);
    expect(out.revenue7d.docketShareCents).toBe(0n);
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.getOverviewMetrics(),
    ).rejects.toThrow(/admin role required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listAttorneys
// ─────────────────────────────────────────────────────────────────────

describe("admin.listAttorneys", () => {
  it("returns full list with status totals", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.listAttorneys({});
    expect(out.totals.all).toBe(2);
    expect(out.totals.active).toBe(1);
    expect(out.totals.pending).toBe(1);
    expect(out.items.length).toBe(2);
    // Sorted newest first; both attorneys created in same beforeEach so
    // either ordering is fine — just assert membership.
    const ids = out.items.map((i) => i.userId).sort();
    expect(ids).toEqual([ATTORNEY_A, ATTORNEY_B].sort());
  });

  it("filters by status", async (ctx) => {
    gate(ctx);
    const active = await callAs(ADMIN).admin.listAttorneys({ status: "active" });
    expect(active.items.length).toBe(1);
    expect(active.items[0]!.status).toBe("active");

    const pending = await callAs(ADMIN).admin.listAttorneys({ status: "pending" });
    expect(pending.items.length).toBe(1);
    expect(pending.items[0]!.status).toBe("pending");
  });

  it("returns empty array (not error) when no attorneys exist", async (ctx) => {
    const d = gate(ctx);
    await d.delete(attorneyProfiles);
    const out = await callAs(ADMIN).admin.listAttorneys({});
    expect(out.items).toEqual([]);
    expect(out.totals.all).toBe(0);
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.listAttorneys({}),
    ).rejects.toThrow(/admin role required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listAllCases
// ─────────────────────────────────────────────────────────────────────

describe("admin.listAllCases", () => {
  it("returns cases across all orgs with totals by status", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.listAllCases({});
    expect(out.totals.total).toBe(3);
    expect(out.totals.byStatus.intake).toBe(1);
    expect(out.totals.byStatus.draft_ready).toBe(1);
    expect(out.totals.byStatus.filed).toBe(1);
    expect(out.items.length).toBe(3);
    // Each item resolves its primary attorney via the join.
    const filedRow = out.items.find((c) => c.id === CASE_FILED);
    expect(filedRow?.primaryAttorney?.id).toBe(ATTORNEY_A);
  });

  it("filters by status", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.listAllCases({ status: "filed" });
    expect(out.items.length).toBe(1);
    expect(out.items[0]!.status).toBe("filed");
  });

  it("filters by visa type", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.listAllCases({ visaType: "EB-1A" });
    // Seed: CASE_DRAFT is EB-1A.
    expect(out.items.map((i) => i.id)).toContain(CASE_DRAFT);
    expect(out.items.every((i) => i.visaType === "EB-1A")).toBe(true);
  });

  it("returns empty when nothing matches", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.listAllCases({ visaType: "TN" });
    expect(out.items).toEqual([]);
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.listAllCases({}),
    ).rejects.toThrow(/admin role required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// listAuditEvents
// ─────────────────────────────────────────────────────────────────────

describe("admin.listAuditEvents", () => {
  it("returns recent events newest-first with actor email joined", async (ctx) => {
    const d = gate(ctx);
    await d.insert(auditLog).values([
      {
        actorType: "user",
        actorUserId: ADMIN,
        action: "attorney.activate",
        targetType: "user",
        targetId: ATTORNEY_A,
        details: { reason: "test" },
      },
      {
        actorType: "user",
        actorUserId: ADMIN,
        action: "waitlist.approve",
        targetType: "waitlist_entry",
        targetId: ATTORNEY_B,
        details: { email: "wl@example.com" },
      },
    ]);

    const out = await callAs(ADMIN).admin.listAuditEvents({});
    expect(out.items.length).toBe(2);
    // Both events authored by ADMIN — actor email should be joined.
    expect(out.items[0]!.actorEmail).toBe("test-admin@docket.local");
    // Messages are templated for known actions.
    expect(out.items.find((e) => e.action === "waitlist.approve")?.message).toMatch(
      /wl@example.com/,
    );
  });

  it("filters by action prefix", async (ctx) => {
    const d = gate(ctx);
    await d.insert(auditLog).values([
      { actorType: "user", actorUserId: ADMIN, action: "attorney.activate", targetType: "user", targetId: ATTORNEY_A, details: null },
      { actorType: "user", actorUserId: ADMIN, action: "waitlist.approve", targetType: "waitlist_entry", targetId: ATTORNEY_B, details: null },
    ]);

    const out = await callAs(ADMIN).admin.listAuditEvents({ actionPrefix: "attorney." });
    expect(out.items.every((e) => e.action.startsWith("attorney."))).toBe(true);
    expect(out.items.length).toBe(1);
  });

  it("returns empty + zero byPrefix when no events exist", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.listAuditEvents({});
    expect(out.items).toEqual([]);
    expect(Object.keys(out.byPrefix)).toEqual([]);
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.listAuditEvents({}),
    ).rejects.toThrow(/admin role required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getRevenueMetrics
// ─────────────────────────────────────────────────────────────────────

describe("admin.getRevenueMetrics", () => {
  it("aggregates filed cases for the requested period", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.getRevenueMetrics({ period: "MTD" });
    expect(out.totals.filings).toBe(1);
    expect(out.totals.grossCents).toBe(500000n);
    expect(out.totals.docketCents).toBe(75000n);
    expect(out.totals.attorneyCents).toBe(425000n);
    // byVisa breakdown — filed case is O-1A in our seed.
    expect(out.byVisa.find((v) => v.visa === "O-1A")?.count).toBe(1);
  });

  it("returns zero shape when no cases are filed", async (ctx) => {
    const d = gate(ctx);
    await d.update(cases).set({ filedAt: null });

    const out = await callAs(ADMIN).admin.getRevenueMetrics({ period: "MTD" });
    expect(out.totals.filings).toBe(0);
    expect(out.totals.grossCents).toBe(0n);
    expect(out.byVisa).toEqual([]);
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.getRevenueMetrics({ period: "MTD" }),
    ).rejects.toThrow(/admin role required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getComputeMetrics
// ─────────────────────────────────────────────────────────────────────

describe("admin.getComputeMetrics", () => {
  it("returns ledger totals when entries exist", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseComputeLedger).values([
      { caseId: CASE_DRAFT, entryType: "compute_spend", amountCents: 1234n },
      { caseId: CASE_DRAFT, entryType: "compute_spend", amountCents: 800n },
    ]);

    const out = await callAs(ADMIN).admin.getComputeMetrics({ period: "MTD" });
    expect(out.totals.entries).toBe(2);
    expect(out.totals.totalCents).toBe(2034n);
    // Category breakdown placeholder until Stage 10.
    expect(out.byCategory.inferenceCents).toBe(0n);
  });

  it("returns zero shape when ledger is empty", async (ctx) => {
    gate(ctx);
    const out = await callAs(ADMIN).admin.getComputeMetrics({ period: "MTD" });
    expect(out.totals.entries).toBe(0);
    expect(out.totals.totalCents).toBe(0n);
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.getComputeMetrics({ period: "MTD" }),
    ).rejects.toThrow(/admin role required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

async function seedFixtures(d: TestDb): Promise<void> {
  // 2 orgs, 4 users (admin / non-admin / 2 attorneys), 3 cases in different
  // statuses, primary-attorney participants. Truncate-before-file in
  // tests/setup.ts gives us a clean slate; we only need to insert.
  await d.insert(users).values([
    { id: ADMIN, name: "Test Admin", email: "test-admin@docket.local" },
    { id: NON_ADMIN, name: "Test Non-Admin", email: "test-nonadmin@docket.local" },
    { id: ATTORNEY_A, name: "Attorney A", email: "test-att-a@docket.local" },
    { id: ATTORNEY_B, name: "Attorney B", email: "test-att-b@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ADMIN, role: "admin" },
    { userId: ATTORNEY_A, role: "attorney" },
    { userId: ATTORNEY_B, role: "attorney" },
  ]);
  await d.insert(organizations).values([
    { id: ORG_A, name: "Org A", slug: "admin-test-org-a" },
    { id: ORG_B, name: "Org B", slug: "admin-test-org-b" },
  ]);
  await d.insert(organizationMembers).values([
    { organizationId: ORG_A, userId: ATTORNEY_A, role: "owner", status: "active", acceptedAt: new Date() },
    { organizationId: ORG_B, userId: ATTORNEY_B, role: "owner", status: "active", acceptedAt: new Date() },
  ]);
  await d.insert(attorneyProfiles).values([
    { userId: ATTORNEY_A, status: "active" },
    { userId: ATTORNEY_B, status: "pending", submittedAt: new Date() },
  ]);
  await d.insert(cases).values([
    {
      id: CASE_INTAKE,
      organizationId: ORG_A,
      visaType: "O-1A",
      status: "intake",
    },
    {
      id: CASE_DRAFT,
      organizationId: ORG_A,
      visaType: "EB-1A",
      status: "draft_ready",
    },
    {
      id: CASE_FILED,
      organizationId: ORG_A,
      visaType: "O-1A",
      status: "filed",
      caseFeeCents: 500000n,
      docketShareCents: 75000n,
      attorneyShareCents: 425000n,
      filedAt: new Date(),
    },
  ]);
  await d.insert(caseParticipants).values([
    { caseId: CASE_INTAKE, userId: ATTORNEY_A, role: "attorney", isPrimary: true },
    { caseId: CASE_DRAFT, userId: ATTORNEY_A, role: "attorney", isPrimary: true },
    { caseId: CASE_FILED, userId: ATTORNEY_A, role: "attorney", isPrimary: true },
  ]);
}

// Lint guard: keep the seeded id arrays referenced even if a future test
// suite removes its only consumer — they document the test surface.
void ALL_USER_IDS;
void ALL_ORG_IDS;
