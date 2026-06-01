// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseEvents,
  caseParticipants,
  caseRecommenders,
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

/**
 * Stage 05 case router — covers create, list (filters + pagination),
 * get, updateBeneficiary (with optimistic concurrency + status lock),
 * completeIntake (state machine), archive (soft-delete + status flip).
 */

const ALICE = "70000000-0000-4000-8000-aaaa00000001";
const BOB = "70000000-0000-4000-8000-bbbb00000001";
const CAROL_ADMIN = "70000000-0000-4000-8000-eeee00000001";
const CAROL_PROFILE = "70000000-0000-4000-8000-eeee00000002";
const ALICE_ORG = "70000000-0000-4000-8000-cccc00000001";
const BOB_ORG = "70000000-0000-4000-8000-dddd00000001";

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
    { id: ALICE, name: "Test Alice CR", email: "case-alice@docket.local" },
    { id: BOB, name: "Test Bob CR", email: "case-bob@docket.local" },
    { id: CAROL_ADMIN, name: "Test Carol CR", email: "case-carol@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ALICE, role: "attorney" },
    { userId: BOB, role: "attorney" },
    // Carol carries both roles: admin (so `is_admin()` RLS bypass fires
    // on her sessions, the exact condition the gate tests defend
    // against) and attorney (so `attorneyProcedure` middleware lets her
    // through to the participant gate rather than 403-ing first).
    { userId: CAROL_ADMIN, role: "admin" },
    { userId: CAROL_ADMIN, role: "attorney" },
  ]);
  await db.insert(attorneyProfiles).values({
    id: CAROL_PROFILE,
    userId: CAROL_ADMIN,
    status: "active",
  });
  await db.insert(organizations).values([
    { id: ALICE_ORG, name: "Alice Org CR", slug: "case-alice-org" },
    { id: BOB_ORG, name: "Bob Org CR", slug: "case-bob-org" },
  ]);
  await db.insert(organizationMembers).values([
    { organizationId: ALICE_ORG, userId: ALICE, role: "owner", status: "active", acceptedAt: new Date() },
    { organizationId: BOB_ORG, userId: BOB, role: "owner", status: "active", acceptedAt: new Date() },
  ]);
});

beforeEach(async () => {
  if (!db) return;
  // Wipe cases (and their cascade-deleted children) between tests so
  // list/pagination assertions start from a known place.
  await db.execute(
    sql`delete from cases where organization_id in (${ALICE_ORG}, ${BOB_ORG})`,
  );
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("case.create", () => {
  it("creates a case with the caller as primary attorney participant", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });

    const [row] = await db.select().from(cases).where(eq(cases.id, id));
    expect(row?.status).toBe("intake");
    expect(row?.organizationId).toBe(ALICE_ORG);
    expect(row?.visaType).toBe("O-1A");
    expect(row?.reviewSlaHours).toBe(72); // default

    const parts = await db
      .select()
      .from(caseParticipants)
      .where(eq(caseParticipants.caseId, id));
    expect(parts).toHaveLength(1);
    expect(parts[0]?.userId).toBe(ALICE);
    expect(parts[0]?.role).toBe("attorney");
    expect(parts[0]?.isPrimary).toBe(true);

    const events = await db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, id));
    expect(events.find((e) => e.eventType === "case.created")).toBeDefined();
  });

  it("accepts beneficiaryData on create", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({
      visaType: "O-1A",
      beneficiaryData: { fullName: "Test Bene", nationality: "Canada" },
    });
    const [row] = await db.select().from(cases).where(eq(cases.id, id));
    expect(row?.beneficiaryData).toMatchObject({
      fullName: "Test Bene",
      nationality: "Canada",
    });
  });

  it("UNAUTHORIZED when not signed in", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(null).case.create({ visaType: "O-1A" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("case.list", () => {
  it("returns only the caller's cases (RLS scopes)", async (ctx) => {
    gate(ctx);
    const { id: aliceCase } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await callAs(BOB).case.create({ visaType: "O-1A" });

    const aliceList = await callAs(ALICE).case.list({});
    expect(aliceList.items.map((c) => c.id)).toEqual([aliceCase]);
  });

  it("filters by status", async (ctx) => {
    gate(ctx);
    await callAs(ALICE).case.create({ visaType: "O-1A" });
    const list = await callAs(ALICE).case.list({ status: ["intake"] });
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    const empty = await callAs(ALICE).case.list({ status: ["filed"] });
    expect(empty.items).toHaveLength(0);
  });

  it("filters by visaType", async (ctx) => {
    const db = gate(ctx);
    await callAs(ALICE).case.create({ visaType: "O-1A" });
    // case.create is gated to supported visa types (Phase 1: O-1A only).
    // The list filter still has to work for any DB-enum value, so seed
    // the EB-1A row directly. Participant row needed for RLS scoping.
    await db.insert(cases).values({
      organizationId: ALICE_ORG,
      visaType: "EB-1A",
      status: "intake",
    });
    const [ebRow] = await db
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.visaType, "EB-1A"));
    await db.insert(caseParticipants).values({
      caseId: ebRow!.id,
      userId: ALICE,
      role: "attorney",
      isPrimary: true,
    });
    const list = await callAs(ALICE).case.list({ visaType: ["EB-1A"] });
    expect(list.items.every((c) => c.visaType === "EB-1A")).toBe(true);
  });

  it("paginates with cursor", async (ctx) => {
    gate(ctx);
    // Insert > 25 cases to force pagination.
    for (let i = 0; i < 27; i++) {
      await callAs(ALICE).case.create({ visaType: "O-1A" });
    }
    const page1 = await callAs(ALICE).case.list({});
    expect(page1.items).toHaveLength(25);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await callAs(ALICE).case.list({
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBeGreaterThanOrEqual(2);
  });
});

describe("case.get", () => {
  it("returns case + participants + events for the owner", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    const got = await callAs(ALICE).case.get({ caseId: id });
    expect(got?.id).toBe(id);
    expect(got?.participants).toHaveLength(1);
    expect(got?.events.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null for a non-participant (RLS denies)", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    const got = await callAs(BOB).case.get({ caseId: id });
    expect(got).toBeNull();
  });
});

// Regression net for open_issues #59. The `cases_admin` RLS policy
// (0005_rls.sql:138-139) grants admins blanket access via `is_admin()`,
// so an admin who is not a case participant USED to see every attorney's
// case on the attorney dashboard. The application-layer participant
// gate in case.list / case.get must hold even when RLS would let
// the read through. If these assertions ever start failing, somebody
// dropped the explicit participant filter; do not "fix" by trusting
// RLS — restore the filter.
describe("case.list / case.get — admin participant gate", () => {
  it("an admin who is not a participant sees no cases via case.list", async (ctx) => {
    gate(ctx);
    await callAs(ALICE).case.create({ visaType: "O-1A" });
    await callAs(BOB).case.create({ visaType: "O-1A" });

    const list = await callAs(CAROL_ADMIN).case.list({});
    expect(list.items).toEqual([]);
    expect(list.nextCursor).toBeNull();
  });

  it("an admin who is not a participant gets null from case.get", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });

    const got = await callAs(CAROL_ADMIN).case.get({ caseId: id });
    expect(got).toBeNull();
  });

  it("an admin who IS added as a participant sees the case", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await db.insert(caseParticipants).values({
      caseId: id,
      userId: CAROL_ADMIN,
      role: "observer",
      isPrimary: false,
    });

    const list = await callAs(CAROL_ADMIN).case.list({});
    expect(list.items.map((c) => c.id)).toEqual([id]);

    const got = await callAs(CAROL_ADMIN).case.get({ caseId: id });
    expect(got?.id).toBe(id);
  });
});

// Regression net for open_issues #59f. Every case.ts procedure that
// reads / writes a single case must application-gate on
// `caseParticipants` membership; RLS alone is bypassed for admins. If
// any of these tests start passing without raising NOT_FOUND, somebody
// removed the `isUserCaseParticipant` gate from that procedure —
// restore it. One test per procedure so the describe block tracks the
// router's procedure list 1:1.
describe("case.* — admin participant gate (regression net for #59f)", () => {
  async function aliceCase(d: TestDb): Promise<{ id: string; rev: number }> {
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    const [row] = await d
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));
    return { id, rev: row!.rev };
  }

  it("updateBeneficiary → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id, rev } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.updateBeneficiary({
        caseId: id,
        patch: { occupation: "Engineer" },
        expectedRowRevision: rev,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("completeIntake → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id, rev } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.completeIntake({
        caseId: id,
        expectedRowRevision: rev,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("readiness → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.readiness({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requestBuild → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.requestBuild({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("markFiled → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.markFiled({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("archive → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.archive({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("criteriaCoverage → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.criteriaCoverage({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requiredDocsCoverage → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.requiredDocsCoverage({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("storageUsage → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.storageUsage({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recommenderLetterCoverage → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.recommenderLetterCoverage({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("preflight → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.preflight({ caseId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("setPackageOrder → NOT_FOUND for off-case admin", async (ctx) => {
    const d = gate(ctx);
    const { id } = await aliceCase(d);
    await expect(
      callAs(CAROL_ADMIN).case.setPackageOrder({
        caseId: id,
        orderedKeys: ["personal_statement"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("case.updateBeneficiary", () => {
  it("partial-merges patch into existing beneficiaryData", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({
      visaType: "O-1A",
      beneficiaryData: { fullName: "Original Name", nationality: "Canada" },
    });
    const [row] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    await callAs(ALICE).case.updateBeneficiary({
      caseId: id,
      patch: { occupation: "Engineer" },
      expectedRowRevision: row!.rev,
    });

    const [after] = await db
      .select({ data: cases.beneficiaryData })
      .from(cases)
      .where(eq(cases.id, id));
    expect(after?.data).toMatchObject({
      fullName: "Original Name",
      nationality: "Canada",
      occupation: "Engineer",
    });
  });

  it("self-heals a legacy key out of the stored blob on save (#69)", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({
      visaType: "O-1A",
      beneficiaryData: { fullName: "Original Name" },
    });
    // Inject a since-removed key directly, bypassing the strict create
    // path, to simulate a row written before the country-Combobox
    // migration. `as never` mirrors the unknown-field seed idiom below.
    await db
      .update(cases)
      .set({
        beneficiaryData: {
          fullName: "Original Name",
          currentLocation: "London, UK",
        } as never,
      })
      .where(eq(cases.id, id));
    const [seeded] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    await callAs(ALICE).case.updateBeneficiary({
      caseId: id,
      patch: { occupation: "Engineer" },
      expectedRowRevision: seeded!.rev,
    });

    const [after] = await db
      .select({ data: cases.beneficiaryData })
      .from(cases)
      .where(eq(cases.id, id));
    expect(after?.data).toEqual({
      fullName: "Original Name",
      occupation: "Engineer",
    });
    expect(after?.data).not.toHaveProperty("currentLocation");
  });

  it("CONFLICT on stale rowRevision (optimistic concurrency)", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });

    await expect(
      callAs(ALICE).case.updateBeneficiary({
        caseId: id,
        patch: { occupation: "Lawyer" },
        expectedRowRevision: 999,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("CONFLICT once status is past documents_pending (locked)", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    // Manually move case to extracting (simulating Stage 06).
    await db.update(cases).set({ status: "extracting" }).where(eq(cases.id, id));
    const [row] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    await expect(
      callAs(ALICE).case.updateBeneficiary({
        caseId: id,
        patch: { occupation: "Locked" },
        expectedRowRevision: row!.rev,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("BAD_REQUEST on unknown beneficiary fields (strict schema)", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await expect(
      callAs(ALICE).case.updateBeneficiary({
        caseId: id,
        patch: { socialSecurityNumber: "123-45-6789" } as never,
        expectedRowRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("BAD_REQUEST on empty patch (no-op rejected up front)", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await expect(
      callAs(ALICE).case.updateBeneficiary({
        caseId: id,
        patch: {},
        expectedRowRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("case.completeIntake", () => {
  it("transitions intake → documents_pending and writes status_changed event", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    // O-1A requires ≥3 recommenders before completeIntake will accept
    // the case. Seed three minimal rows (full_name + relationship are
    // the only NOT NULL columns aside from defaults).
    await db.insert(caseRecommenders).values([
      { caseId: id, displayOrder: 0, fullName: "Rec One", relationship: "Advisor" },
      { caseId: id, displayOrder: 1, fullName: "Rec Two", relationship: "Co-author" },
      { caseId: id, displayOrder: 2, fullName: "Rec Three", relationship: "Manager" },
    ]);
    const [row] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    const result = await callAs(ALICE).case.completeIntake({
      caseId: id,
      expectedRowRevision: row!.rev,
    });
    expect(result.from).toBe("intake");
    expect(result.to).toBe("documents_pending");

    const [after] = await db
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, id));
    expect(after?.status).toBe("documents_pending");

    const events = await db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, id));
    expect(
      events.find((e) => e.eventType === "case.status_changed"),
    ).toBeDefined();
  });

  it("BAD_REQUEST when O-1A case has fewer than 3 recommenders", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    // Seed only two — under the O-1A minimum.
    await db.insert(caseRecommenders).values([
      { caseId: id, displayOrder: 0, fullName: "Rec One", relationship: "Advisor" },
      { caseId: id, displayOrder: 1, fullName: "Rec Two", relationship: "Co-author" },
    ]);
    const [row] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    await expect(
      callAs(ALICE).case.completeIntake({
        caseId: id,
        expectedRowRevision: row!.rev,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("EB-1A intake completes with zero recommenders (no minimum configured)", async (ctx) => {
    // EB-1A has no `minRecommenders` in the visa config; the gate
    // must skip the count check entirely. case.create is gated to
    // O-1A in Phase 1, so seed the EB-1A row directly.
    const db = gate(ctx);
    const [seeded] = await db
      .insert(cases)
      .values({
        organizationId: ALICE_ORG,
        visaType: "EB-1A",
        status: "intake",
      })
      .returning({ id: cases.id });
    const id = seeded!.id;
    await db.insert(caseParticipants).values({
      caseId: id,
      userId: ALICE,
      role: "attorney",
      isPrimary: true,
    });
    const [row] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    const result = await callAs(ALICE).case.completeIntake({
      caseId: id,
      expectedRowRevision: row!.rev,
    });
    expect(result.to).toBe("documents_pending");
  });

  it("CONFLICT when status is not intake (illegal transition)", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await db.update(cases).set({ status: "draft_ready" }).where(eq(cases.id, id));
    const [row] = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, id));

    await expect(
      callAs(ALICE).case.completeIntake({
        caseId: id,
        expectedRowRevision: row!.rev,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("case.archive", () => {
  it("flips status → archived AND soft-deletes the case", async (ctx) => {
    const db = gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await callAs(ALICE).case.archive({ caseId: id, reason: "test cleanup" });

    const [row] = await db
      .select({ status: cases.status, deletedAt: cases.deletedAt })
      .from(cases)
      .where(eq(cases.id, id));
    expect(row?.status).toBe("archived");
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("a soft-deleted case is hidden from case.list", async (ctx) => {
    gate(ctx);
    const { id } = await callAs(ALICE).case.create({ visaType: "O-1A" });
    await callAs(ALICE).case.archive({ caseId: id });
    const list = await callAs(ALICE).case.list({});
    expect(list.items.find((c) => c.id === id)).toBeUndefined();
  });
});

async function teardown(db: TestDb): Promise<void> {
  await db.execute(
    sql`delete from cases where organization_id in (${ALICE_ORG}, ${BOB_ORG})`,
  );
  await db.execute(
    sql`delete from organization_members where organization_id in (${ALICE_ORG}, ${BOB_ORG})`,
  );
  await db.execute(
    sql`delete from organizations where id in (${ALICE_ORG}, ${BOB_ORG})`,
  );
  await db.execute(
    sql`delete from attorney_profiles where user_id in (${ALICE}, ${BOB}, ${CAROL_ADMIN})`,
  );
  await db.execute(
    sql`delete from user_roles where user_id in (${ALICE}, ${BOB}, ${CAROL_ADMIN})`,
  );
  await db.execute(
    sql`delete from users where id in (${ALICE}, ${BOB}, ${CAROL_ADMIN})`,
  );
}
