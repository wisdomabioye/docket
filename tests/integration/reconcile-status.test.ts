// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  caseEvents,
  caseOutputs,
  caseParticipants,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { reconcileCaseStatus } from "@/server/services/cases/reconcile-status";
import type { Db } from "@/server/db/client";
import { closeTestDb, getTestDb, type TestDb } from "../helpers/db";

/**
 * Integration test for `reconcileCaseStatus` — exercises the live path:
 * case-row lock, tally read against `case_outputs`, `transitionCase`
 * call, `case_events` row written. Owner connection (RLS bypassed)
 * matches the contract callers will use.
 */

const ATTORNEY = "f2000000-0000-4000-8000-aaaa00000001";
const ORG = "f2000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f2000000-0000-4000-8000-cccc00000001";

let db: TestDb | null = null;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  await teardown(db);
  await db.insert(users).values({
    id: ATTORNEY,
    name: "Reconciler Attorney",
    email: "reconcile-att@docket.local",
  });
  await db.insert(userRoles).values({ userId: ATTORNEY, role: "attorney" });
  await db.insert(organizations).values({
    id: ORG,
    name: "Reconciler Org",
    slug: "reconcile-test-org",
  });
  await db.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
});

beforeEach(async () => {
  if (!db) return;
  await db.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from cases where id = ${CASE_ID}`);
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
    | "filed",
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

async function seedOutputs(
  d: TestDb,
  rows: ReadonlyArray<{ approved: boolean }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "personal_statement",
      outputVersion: i + 1,
      subgroupKey: `slot-${i}`,
      title: `Output ${i}`,
      content: "test content",
      isCurrent: true,
      attorneyApproved: row.approved,
    });
  }
}

describe("reconcileCaseStatus — integration", () => {
  it("draft_ready + output_edited → in_review (writes case_events row)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "draft_ready");
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "output_edited",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result).toMatchObject({
      from: "draft_ready",
      to: "in_review",
      changed: true,
    });
    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("in_review");

    const events = await d
      .select({ eventType: caseEvents.eventType })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, CASE_ID));
    const transitions = events.filter(
      (e) => e.eventType === "case.status_changed",
    );
    expect(transitions).toHaveLength(1);
  });

  it("in_review + output_approval_changed with all approved → approved", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "in_review");
    await seedOutputs(d, [{ approved: true }, { approved: true }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "output_approval_changed",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.from).toBe("in_review");
    expect(result.to).toBe("approved");
    expect(result.changed).toBe(true);
    expect(result.allApproved).toBe(true);
  });

  it("draft_ready + output_approval_changed with all approved → approved (fixed-point: 2-hop chain)", async (ctx) => {
    // Regression for the original bug: without iteration, the case
    // would land on `in_review` and stick there with all outputs
    // approved. The reconciler must drive `draft_ready → in_review →
    // approved` in a single call when signals support it.
    const d = gate(ctx);
    await seedCase(d, "draft_ready");
    await seedOutputs(d, [{ approved: true }, { approved: true }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "output_approval_changed",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.from).toBe("draft_ready");
    expect(result.to).toBe("approved");
    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("approved");
    // Two hops → exactly two `case.status_changed` events.
    const events = await d
      .select({ eventType: caseEvents.eventType })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, CASE_ID));
    expect(
      events.filter((e) => e.eventType === "case.status_changed"),
    ).toHaveLength(2);
  });

  it("in_review + output_approval_changed with partial approval → no-op", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "in_review");
    await seedOutputs(d, [{ approved: true }, { approved: false }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "output_approval_changed",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.changed).toBe(false);
    expect(result.from).toBe("in_review");
    expect(result.to).toBe("in_review");
    expect(result.allApproved).toBe(false);
  });

  it("approved + output_approval_changed losing all-approved → in_review (Phase 1, NOT needs_revision)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "approved");
    await seedOutputs(d, [{ approved: true }, { approved: false }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "output_approval_changed",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.to).toBe("in_review");
    expect(result.changed).toBe(true);
    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("in_review");
  });

  it("approved + package_delivered → delivered (skipping package_ready)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "approved");
    await seedOutputs(d, [{ approved: true }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "package_delivered",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.to).toBe("delivered");
  });

  it("delivered + filed_marked → filed", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "delivered");
    await seedOutputs(d, [{ approved: true }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "filed_marked",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.to).toBe("filed");
  });

  it("filed + unfiled → delivered (admin reverse path)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "filed");
    await seedOutputs(d, [{ approved: true }]);
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "unfiled",
        actor: { type: "system" },
      }),
    );
    expect(result.to).toBe("delivered");
  });

  it("unmatched (status, trigger) → no-op (no case_events row)", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "draft_ready");
    const result = await d.transaction(async (tx) =>
      reconcileCaseStatus({
        tx: tx as unknown as Db,
        caseId: CASE_ID,
        trigger: "package_delivered",
        actor: { type: "user", userId: ATTORNEY },
      }),
    );
    expect(result.changed).toBe(false);
    const events = await d
      .select({ id: caseEvents.id })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, CASE_ID));
    expect(events).toHaveLength(0);
  });

  it("missing case → NOT_FOUND", async (ctx) => {
    gate(ctx);
    const ghost = "f2000000-0000-4000-8000-cccc99999999";
    await expect(
      db!.transaction(async (tx) =>
        reconcileCaseStatus({
          tx: tx as unknown as Db,
          caseId: ghost,
          trigger: "output_edited",
          actor: { type: "system" },
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from cases where id = ${CASE_ID}`);
  await d.execute(sql`delete from organization_members where organization_id = ${ORG}`);
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(sql`delete from user_roles where user_id = ${ATTORNEY}`);
  await d.execute(sql`delete from users where id = ${ATTORNEY}`);
}
