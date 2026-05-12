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
  caseEvents,
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
 * Stage 11 dashboard-feed procedures: pipelineCounts, dashboardKpis,
 * todayTasks, activityFeed.
 *
 * Each procedure is RLS-scoped, so we seed a second attorney with
 * their own cases and assert the first attorney never sees the
 * second's data through any of the four feeds.
 */

const ALICE = "70000040-0000-4000-8000-aaaa00000001";
const BOB = "70000040-0000-4000-8000-bbbb00000001";
const CAROL_ADMIN = "70000040-0000-4000-8000-aaaa00000002";
const ALICE_ORG = "70000040-0000-4000-8000-cccc00000001";
const BOB_ORG = "70000040-0000-4000-8000-dddd00000001";
const ALICE_PROFILE = "70000040-0000-4000-8000-eeee00000001";
const BOB_PROFILE = "70000040-0000-4000-8000-ffff00000001";

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
// pipelineCounts
// ─────────────────────────────────────────────────────────────────────

describe("me.pipelineCounts", () => {
  it("returns zeros when caller has no cases", async (ctx) => {
    gate(ctx);
    const out = await callAs(ALICE).me.pipelineCounts();
    expect(out).toEqual({
      intake: 0,
      documents: 0,
      drafting: 0,
      review: 0,
      filed: 0,
    });
  });

  it("buckets cases per the dashboard mapping", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "intake");
    await seedAliceCase(d, "documents_pending");
    await seedAliceCase(d, "extracting");
    await seedAliceCase(d, "ready_to_build");
    await seedAliceCase(d, "building");
    await seedAliceCase(d, "draft_ready");
    await seedAliceCase(d, "in_review");
    await seedAliceCase(d, "filed");
    const out = await callAs(ALICE).me.pipelineCounts();
    expect(out).toEqual({
      intake: 1,
      documents: 3, // documents_pending + extracting + ready_to_build
      drafting: 2, // building + draft_ready
      review: 1, // in_review
      filed: 1,
    });
  });

  it("RLS scopes — Bob's cases never appear in Alice's counts", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "intake");
    await seedBobCase(d, "intake");
    const aliceOut = await callAs(ALICE).me.pipelineCounts();
    const bobOut = await callAs(BOB).me.pipelineCounts();
    expect(aliceOut.intake).toBe(1);
    expect(bobOut.intake).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// dashboardKpis
// ─────────────────────────────────────────────────────────────────────

describe("me.dashboardKpis", () => {
  it("counts non-archived cases as active", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "intake");
    await seedAliceCase(d, "filed");
    const out = await callAs(ALICE).me.dashboardKpis();
    expect(out.activeCases).toBe(2);
  });

  it("counts draft_ready + needs_revision as drafts awaiting review", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "draft_ready");
    await seedAliceCase(d, "needs_revision");
    await seedAliceCase(d, "in_review");
    const out = await callAs(ALICE).me.dashboardKpis();
    expect(out.draftsAwaitingReview).toBe(2);
  });

  it("returns 0 revenue MTD when no docket shares fall in the current month", async (ctx) => {
    gate(ctx);
    const out = await callAs(ALICE).me.dashboardKpis();
    expect(out.revenueMtdCents).toBe(0n);
  });
});

// ─────────────────────────────────────────────────────────────────────
// todayTasks
// ─────────────────────────────────────────────────────────────────────

describe("me.todayTasks", () => {
  it("returns only actionable cases (draft_ready, documents_pending, build_failed, needs_revision)", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "draft_ready");
    await seedAliceCase(d, "intake");
    const out = await callAs(ALICE).me.todayTasks();
    expect(out.length).toBe(1);
    expect(out[0]!.status).toBe("draft_ready");
  });

  it("includes a derived label + sub per status", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "documents_pending");
    const out = await callAs(ALICE).me.todayTasks();
    expect(out[0]!.label).toMatch(/upload documents/i);
    expect(out[0]!.sub).toMatch(/uploads/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// activityFeed
// ─────────────────────────────────────────────────────────────────────

describe("me.activityFeed", () => {
  it("returns the newest case_events scoped to the caller's cases", async (ctx) => {
    const d = gate(ctx);
    const aliceCaseId = await seedAliceCase(d, "intake");
    await d.insert(caseEvents).values([
      {
        caseId: aliceCaseId,
        actorType: "user",
        actorUserId: ALICE,
        eventType: "case.created",
      },
    ]);
    const out = await callAs(ALICE).me.activityFeed();
    expect(out.length).toBe(1);
    expect(out[0]!.eventType).toBe("case.created");
  });

  it("RLS blocks Bob from seeing Alice's events", async (ctx) => {
    const d = gate(ctx);
    const aliceCaseId = await seedAliceCase(d, "intake");
    await d.insert(caseEvents).values([
      {
        caseId: aliceCaseId,
        actorType: "user",
        actorUserId: ALICE,
        eventType: "case.created",
      },
    ]);
    const out = await callAs(BOB).me.activityFeed();
    expect(out.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// open_issues #59 confirmation audit
//
// The four `me.*` procedures already filter explicitly via
// `innerJoin(case_participants, userId = ctx.userId AND is_primary AND
// removed_at IS NULL)` — not RLS alone. These tests anchor that
// invariant: a global-admin caller who is NOT a primary participant on
// any case must see zeros / empty arrays. If these fail, someone
// "simplified" the explicit join away in favor of RLS; restore it.
// ─────────────────────────────────────────────────────────────────────

describe("me.* — admin participant gate (regression net for #59)", () => {
  it("pipelineCounts returns zeros for an admin not on any case", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "intake");
    await seedBobCase(d, "intake");
    const out = await callAs(CAROL_ADMIN).me.pipelineCounts();
    expect(out).toEqual({
      intake: 0,
      documents: 0,
      drafting: 0,
      review: 0,
      filed: 0,
    });
  });

  it("dashboardKpis returns zeros for an admin not on any case", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "draft_ready");
    await seedBobCase(d, "filed");
    const out = await callAs(CAROL_ADMIN).me.dashboardKpis();
    expect(out.activeCases).toBe(0);
    expect(out.draftsAwaitingReview).toBe(0);
    expect(out.filedThisQuarter).toBe(0);
    expect(out.revenueMtdCents).toBe(0n);
  });

  it("todayTasks returns [] for an admin not on any case", async (ctx) => {
    const d = gate(ctx);
    await seedAliceCase(d, "draft_ready");
    await seedBobCase(d, "needs_revision");
    const out = await callAs(CAROL_ADMIN).me.todayTasks();
    expect(out).toEqual([]);
  });

  it("activityFeed returns [] for an admin not on any case", async (ctx) => {
    const d = gate(ctx);
    const aliceCaseId = await seedAliceCase(d, "intake");
    await d.insert(caseEvents).values({
      caseId: aliceCaseId,
      actorType: "user",
      actorUserId: ALICE,
      eventType: "case.created",
    });
    const out = await callAs(CAROL_ADMIN).me.activityFeed();
    expect(out).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function seedFixtures(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ALICE, name: "Dash Alice", email: "dash-alice@docket.local" },
    { id: BOB, name: "Dash Bob", email: "dash-bob@docket.local" },
    { id: CAROL_ADMIN, name: "Dash Carol", email: "dash-carol@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ALICE, role: "attorney" },
    { userId: BOB, role: "attorney" },
    { userId: CAROL_ADMIN, role: "admin" },
  ]);
  await d.insert(organizations).values([
    { id: ALICE_ORG, name: "Alice Dash Org", slug: "dash-alice-org" },
    { id: BOB_ORG, name: "Bob Dash Org", slug: "dash-bob-org" },
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

type CaseStatus = Parameters<TestDb["insert"]>[0] extends never
  ? never
  : "intake"
    | "documents_pending"
    | "extracting"
    | "ready_to_build"
    | "building"
    | "build_failed"
    | "draft_ready"
    | "in_review"
    | "needs_revision"
    | "approved"
    | "package_ready"
    | "delivered"
    | "filed"
    | "archived";

async function seedAliceCase(
  d: TestDb,
  status: CaseStatus,
): Promise<string> {
  return seedCase(d, ALICE_ORG, ALICE, status);
}

async function seedBobCase(
  d: TestDb,
  status: CaseStatus,
): Promise<string> {
  return seedCase(d, BOB_ORG, BOB, status);
}

async function seedCase(
  d: TestDb,
  orgId: string,
  primaryUserId: string,
  status: CaseStatus,
): Promise<string> {
  const [created] = await d
    .insert(cases)
    .values({
      organizationId: orgId,
      visaType: "O-1A",
      status,
    })
    .returning({ id: cases.id });
  if (!created) throw new Error("seedCase failed");
  await d.insert(caseParticipants).values({
    caseId: created.id,
    userId: primaryUserId,
    role: "attorney",
    isPrimary: true,
  });
  return created.id;
}

// Suppress unused-export warning; eq is needed when extending tests.
void eq;
