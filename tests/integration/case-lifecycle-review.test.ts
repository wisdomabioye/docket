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
  vi.fn(async () => ({
    success: true,
    limit: 20,
    remaining: 19,
    reset: 0,
  })),
);
vi.mock("@/server/services/ratelimit", () => ({ rateLimit: rateLimitMock }));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * Step 4 — full review-cycle lifecycle through the live tRPC stack.
 *
 * Asserts the contract from ADR-006:
 *   - draft_ready → in_review on first save / approve / restore
 *   - in_review → approved when tally flips to all-approved
 *   - approved → in_review (NOT needs_revision) on backslide
 *     (unapprove, regenerate, restore-with-fresh-row)
 *   - assertOutputMutationAllowed lock on delivered/filed/archived
 *     for all four restricted procedures (output.approve excluded)
 *   - package.ready notification fires once per all-approved tally
 *     flip, using the reconciler's allApproved return
 *   - case_events records every transition; needs_revision is NEVER
 *     written by Phase 1 production code
 */

const ATTORNEY = "f3000000-0000-4000-8000-aaaa00000001";
const ORG = "f3000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f3000000-0000-4000-8000-cccc00000001";

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
  await db.insert(users).values({
    id: ATTORNEY,
    name: "Lifecycle Attorney",
    email: "lifecycle-att@docket.local",
  });
  await db.insert(userRoles).values({ userId: ATTORNEY, role: "attorney" });
  await db.insert(organizations).values({
    id: ORG,
    name: "Lifecycle Org",
    slug: "lifecycle-review-org",
  });
  await db.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await db.insert(attorneyProfiles).values({
    userId: ATTORNEY,
    status: "active",
  });
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
    limit: 20,
    remaining: 19,
    reset: 0,
  });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

async function seedCase(
  d: TestDb,
  status:
    | "draft_ready"
    | "in_review"
    | "approved"
    | "delivered"
    | "filed"
    | "archived",
): Promise<void> {
  await d.insert(cases).values({
    id: CASE_ID,
    organizationId: ORG,
    visaType: "O-1A",
    status,
  });
  await d.insert(caseParticipants).values({
    caseId: CASE_ID,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
}

async function seedOutput(
  d: TestDb,
  attorneyApproved: boolean,
  subgroupKey: string,
): Promise<string> {
  const [out] = await d
    .insert(caseOutputs)
    .values({
      caseId: CASE_ID,
      outputType: "personal_statement",
      outputVersion: 1,
      subgroupKey,
      isCurrent: true,
      author: "computer",
      content: "draft prose",
      attorneyApproved,
    })
    .returning({ id: caseOutputs.id });
  if (!out) throw new Error("insert returned no id");
  return out.id;
}

async function caseStatus(d: TestDb): Promise<string | undefined> {
  const [row] = await d
    .select({ status: cases.status })
    .from(cases)
    .where(eq(cases.id, CASE_ID));
  return row?.status;
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

describe("review lifecycle (ADR-006)", () => {
  it("approve last unapproved row in draft_ready drives to approved (2-hop)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "draft_ready");
    const id1 = await seedOutput(d, true, "slot-1");
    const id2 = await seedOutput(d, false, "slot-2");
    void id1;

    await callAs(ATTORNEY).output.approve({ outputId: id2 });

    expect(await caseStatus(d)).toBe("approved");
    expect(await transitionEvents(d)).toEqual([
      { from: "draft_ready", to: "in_review" },
      { from: "in_review", to: "approved" },
    ]);

    // package.ready notification fires exactly once on all-approved.
    const sentNames = sendMock.mock.calls.flatMap((args) => {
      const arg = (args as ReadonlyArray<unknown>)[0];
      const list = Array.isArray(arg) ? arg : [arg];
      return list.map(
        (e) => (e as { name?: string }).name ?? "<unknown>",
      );
    });
    expect(sentNames.filter((n) => n === "notification/package.ready")).toHaveLength(1);
  });

  it("unapprove from approved backslides to in_review — NOT needs_revision", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "approved");
    const id1 = await seedOutput(d, true, "slot-1");
    await seedOutput(d, true, "slot-2");

    await callAs(ATTORNEY).output.unapprove({ outputId: id1 });

    expect(await caseStatus(d)).toBe("in_review");
    const events = await transitionEvents(d);
    expect(events).toEqual([{ from: "approved", to: "in_review" }]);
    expect(events.some((e) => e.to === "needs_revision")).toBe(false);
  });

  it("re-approve after backslide drives back to approved", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "in_review");
    const id1 = await seedOutput(d, false, "slot-1");
    await seedOutput(d, true, "slot-2");

    await callAs(ATTORNEY).output.approve({ outputId: id1 });

    expect(await caseStatus(d)).toBe("approved");
    expect(await transitionEvents(d)).toEqual([
      { from: "in_review", to: "approved" },
    ]);
  });

  it("restoreVersion from approved backslides via output_approval_changed", async (ctx) => {
    // ADR-006 Step 4 amendment: restoreVersion fires
    // `output_approval_changed` (not `output_edited`) because
    // saveOutputVersion produces a new current row with
    // attorneyApproved=false. Without this, an `approved` case would
    // silently desync.
    const d = gate(ctx);
    await seedCase(d, "approved");
    const id1 = await seedOutput(d, true, "slot-1");
    await seedOutput(d, true, "slot-2");

    await callAs(ATTORNEY).output.restoreVersion({ fromVersionId: id1 });

    expect(await caseStatus(d)).toBe("in_review");
  });

  it("regenerate from approved auto-unapproves and backslides", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "approved");
    const id1 = await seedOutput(d, true, "slot-1");
    await seedOutput(d, true, "slot-2");

    await callAs(ATTORNEY).output.regenerate({ outputId: id1 });

    expect(await caseStatus(d)).toBe("in_review");
  });

  it("update from delivered is rejected with the unmark message", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "delivered");
    const id1 = await seedOutput(d, true, "slot-1");

    await expect(
      callAs(ATTORNEY).output.update({ outputId: id1, content: "edit" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/admin\.case\.unmarkFiled/) as never,
    });
    // Status unchanged.
    expect(await caseStatus(d)).toBe("delivered");
  });

  it("unapprove + regenerate + restoreVersion all rejected from filed", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "filed");
    const id1 = await seedOutput(d, true, "slot-1");

    for (const call of [
      () => callAs(ATTORNEY).output.unapprove({ outputId: id1 }),
      () => callAs(ATTORNEY).output.regenerate({ outputId: id1 }),
      () => callAs(ATTORNEY).output.restoreVersion({ fromVersionId: id1 }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await caseStatus(d)).toBe("filed");
  });

  it("approve is permitted from delivered (re-approval is normal review)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "delivered");
    const id1 = await seedOutput(d, true, "slot-1");

    // Idempotent re-approve — no error, no transition.
    await callAs(ATTORNEY).output.approve({ outputId: id1 });
    expect(await caseStatus(d)).toBe("delivered");
  });

  it("approve from archived is rejected even though approve has the loosest gate", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "archived");
    const id1 = await seedOutput(d, false, "slot-1");

    await expect(
      callAs(ATTORNEY).output.approve({ outputId: id1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("saveDraft from draft_ready transitions to in_review on first save", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "draft_ready");
    const id1 = await seedOutput(d, false, "slot-1");

    await callAs(ATTORNEY).output.saveDraft({
      outputId: id1,
      content: "edited prose",
    });

    expect(await caseStatus(d)).toBe("in_review");
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from cases where id = ${CASE_ID}`);
  await d.execute(sql`delete from attorney_profiles where user_id = ${ATTORNEY}`);
  await d.execute(sql`delete from organization_members where organization_id = ${ORG}`);
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(sql`delete from user_roles where user_id = ${ATTORNEY}`);
  await d.execute(sql`delete from users where id = ${ATTORNEY}`);
}
