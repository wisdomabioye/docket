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
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseEvents,
  caseOutputs,
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

const sendMock = vi.hoisted(() =>
  vi.fn(async () => ({ ids: ["evt-test-id"] })),
);
vi.mock("@/server/jobs/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/jobs/client")>(
    "@/server/jobs/client",
  );
  return {
    ...actual,
    inngest: { ...actual.inngest, send: sendMock },
  };
});

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 0 })),
);
vi.mock("@/server/services/ratelimit", () => ({ rateLimit: rateLimitMock }));

vi.mock("@/server/services/pdf", () => ({
  compileFullPackagePdf: vi.fn(async () => ({
    url: "/api/files/package-stub",
    key: "cases/happy/pdf/package.pdf",
    bytes: 4242,
  })),
  renderPerOutputPdf: vi.fn(async () => ({
    url: "/api/files/per-output-stub",
    key: "k",
    bytes: 1234,
  })),
}));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * Step 8 — full happy-path lifecycle, end to end.
 *
 * Drives a single case through every Phase 1 status that a successful
 * filing touches:
 *
 *   draft_ready → in_review → approved → delivered → filed
 *
 * Pre-build statuses (intake / documents_pending / extracting /
 * ready_to_build / building) are NOT exercised here — Stages 5/6/7
 * already cover them. This test seeds the case at `draft_ready` and
 * focuses on the post-build half that ADR-006 owns.
 *
 * Asserts:
 *   - Final status is `filed`.
 *   - `case_events` records every transition in order, with no
 *     `needs_revision` row anywhere.
 *   - All four lifecycle timestamps populated.
 *   - RLS still scopes correctly mid-lifecycle: a non-participant
 *     attorney sees no case state at any point.
 *   - Admin reverse (unmarkFiled) returns the case to `delivered`.
 */

const ATTORNEY = "f7000000-0000-4000-8000-aaaa00000001";
const STRANGER = "f7000000-0000-4000-8000-aaaa00000002";
const ADMIN = "f7000000-0000-4000-8000-aaaa00000003";
const ORG = "f7000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f7000000-0000-4000-8000-cccc00000001";

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
  if (!rlsReady) return;
  await teardown(db);
  await db.insert(users).values([
    {
      id: ATTORNEY,
      name: "Happy Path Attorney",
      email: "lifecycle-hp-att@docket.local",
    },
    {
      id: STRANGER,
      name: "Stranger Attorney",
      email: "lifecycle-hp-str@docket.local",
    },
    { id: ADMIN, name: "Admin", email: "lifecycle-hp-admin@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: STRANGER, role: "attorney" },
    { userId: ADMIN, role: "admin" },
  ]);
  await db.insert(organizations).values({
    id: ORG,
    name: "Happy Path Org",
    slug: "lifecycle-hp-org",
  });
  await db.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await db.insert(attorneyProfiles).values([
    { userId: ATTORNEY, status: "active" },
    { userId: STRANGER, status: "active" },
  ]);
});

beforeEach(async () => {
  if (!db) return;
  await db.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from cases where id = ${CASE_ID}`);
  sendMock.mockClear();
  rateLimitMock.mockClear();
  rateLimitMock.mockResolvedValue({
    success: true,
    limit: 30,
    remaining: 29,
    reset: 0,
  });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

async function seedReadyToReview(d: TestDb): Promise<{
  outputAId: string;
  outputBId: string;
}> {
  await d.insert(cases).values({
    id: CASE_ID,
    organizationId: ORG,
    visaType: "O-1A",
    status: "draft_ready",
  });
  await d.insert(caseParticipants).values({
    caseId: CASE_ID,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
  // Two outputs; both unapproved; build is "complete" from the
  // case-row's perspective.
  const inserted = await d
    .insert(caseOutputs)
    .values([
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        subgroupKey: "slot-a",
        isCurrent: true,
        author: "computer",
        content: "Personal statement v1.",
        attorneyApproved: false,
      },
      {
        caseId: CASE_ID,
        outputType: "petition_letter",
        outputVersion: 1,
        subgroupKey: "slot-b",
        isCurrent: true,
        author: "computer",
        content: "Petition letter v1.",
        attorneyApproved: false,
      },
    ])
    .returning({ id: caseOutputs.id, type: caseOutputs.outputType });
  const a = inserted.find((r) => r.type === "personal_statement");
  const b = inserted.find((r) => r.type === "petition_letter");
  if (!a || !b) throw new Error("seed inserted wrong rows");
  return { outputAId: a.id, outputBId: b.id };
}

async function readCase(d: TestDb): Promise<{
  status: string;
  packageCompiledAt: Date | null;
  deliveredAt: Date | null;
  filedAt: Date | null;
  filedReceiptNumber: string | null;
}> {
  const [row] = await d
    .select({
      status: cases.status,
      packageCompiledAt: cases.packageCompiledAt,
      deliveredAt: cases.deliveredAt,
      filedAt: cases.filedAt,
      filedReceiptNumber: cases.filedReceiptNumber,
    })
    .from(cases)
    .where(eq(cases.id, CASE_ID));
  if (!row) throw new Error("case row missing");
  return row;
}

async function transitionEvents(d: TestDb): Promise<
  Array<{ from: string; to: string }>
> {
  const events = await d
    .select({ details: caseEvents.details, eventType: caseEvents.eventType })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, CASE_ID))
    .orderBy(caseEvents.createdAt);
  return events
    .filter((e) => e.eventType === "case.status_changed")
    .map((e) => {
      const d = e.details as { from: string; to: string };
      return { from: d.from, to: d.to };
    });
}

describe("happy-path lifecycle (ADR-006)", () => {
  it("draft_ready → in_review → approved → delivered → filed → unfiled (admin) → delivered", async (ctx) => {
    const d = gate(ctx);
    const { outputAId, outputBId } = await seedReadyToReview(d);

    // 1) Approve A — case lands at in_review (allApproved=false).
    await callAs(ATTORNEY).output.approve({ outputId: outputAId });
    expect((await readCase(d)).status).toBe("in_review");

    // 2) Approve B — tally flips to all-approved → case → approved.
    await callAs(ATTORNEY).output.approve({ outputId: outputBId });
    expect((await readCase(d)).status).toBe("approved");

    // 3) Download package — case → delivered, both timestamps stamped.
    await callAs(ATTORNEY).output.downloadPackage({ caseId: CASE_ID });
    {
      const row = await readCase(d);
      expect(row.status).toBe("delivered");
      expect(row.packageCompiledAt).toBeInstanceOf(Date);
      expect(row.deliveredAt).toBeInstanceOf(Date);
    }

    // 4) Mark filed with a receipt — case → filed, receipt persisted.
    await callAs(ATTORNEY).case.markFiled({
      caseId: CASE_ID,
      receiptNumber: "MSC2200000777",
    });
    {
      const row = await readCase(d);
      expect(row.status).toBe("filed");
      expect(row.filedAt).toBeInstanceOf(Date);
      expect(row.filedReceiptNumber).toBe("MSC2200000777");
    }

    // 5) case_events records every transition in order, no needs_revision.
    const events = await transitionEvents(d);
    expect(events).toEqual([
      { from: "draft_ready", to: "in_review" },
      { from: "in_review", to: "approved" },
      { from: "approved", to: "delivered" },
      { from: "delivered", to: "filed" },
    ]);
    expect(events.some((e) => e.to === "needs_revision")).toBe(false);
    expect(events.some((e) => e.to === "package_ready")).toBe(false);

    // 6) Admin operational reverse — case → delivered, columns cleared.
    await callAs(ADMIN).admin.unmarkFiledCase({
      caseId: CASE_ID,
      reason: "Receipt typo, attorney needs to re-mark with the correct value.",
    });
    {
      const row = await readCase(d);
      expect(row.status).toBe("delivered");
      expect(row.filedAt).toBeNull();
      expect(row.filedReceiptNumber).toBeNull();
    }
    const eventsAfterReverse = await transitionEvents(d);
    expect(eventsAfterReverse[eventsAfterReverse.length - 1]).toEqual({
      from: "filed",
      to: "delivered",
    });
  });

  it("RLS scopes correctly throughout: a stranger never sees the case at any stage", async (ctx) => {
    const d = gate(ctx);
    const { outputAId, outputBId } = await seedReadyToReview(d);

    // case.get returns `null` for unauthorized callers by design
    // (no existence oracle — see the procedure's comment).
    expect(await callAs(STRANGER).case.get({ caseId: CASE_ID })).toBeNull();

    // Approve both (drives draft_ready → in_review → approved).
    await callAs(ATTORNEY).output.approve({ outputId: outputAId });
    await callAs(ATTORNEY).output.approve({ outputId: outputBId });

    // Stranger STILL can't see the case nor mutate its outputs.
    expect(await callAs(STRANGER).case.get({ caseId: CASE_ID })).toBeNull();
    await expect(
      callAs(STRANGER).output.unapprove({ outputId: outputAId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Move forward to delivered.
    await callAs(ATTORNEY).output.downloadPackage({ caseId: CASE_ID });

    // Stranger cannot mark the case filed.
    await expect(
      callAs(STRANGER).case.markFiled({ caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(sql`delete from audit_log where target_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from cases where id = ${CASE_ID}`);
  await d.execute(
    sql`delete from attorney_profiles where user_id in (${ATTORNEY}, ${STRANGER})`,
  );
  await d.execute(
    sql`delete from organization_members where organization_id = ${ORG}`,
  );
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(
    sql`delete from user_roles where user_id in (${ATTORNEY}, ${STRANGER}, ${ADMIN})`,
  );
  await d.execute(
    sql`delete from users where id in (${ATTORNEY}, ${STRANGER}, ${ADMIN})`,
  );
}
