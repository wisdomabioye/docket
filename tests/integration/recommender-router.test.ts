// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  caseRecommenders,
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
 * Regression net for open_issues #59 (case_recommenders). The
 * `case_participants` admin RLS bypass means an admin who is NOT a
 * case participant USED to be able to list/create/update/remove/reorder
 * recommenders on any attorney's case. The application-layer gate in
 * `gateCaseEdit` / `gateRecommenderEdit` must hold even when RLS would
 * let the read through. If these break, restore the participant check
 * — never trust RLS alone.
 */

const ALICE = "90000000-0000-4000-8000-aaaa00000001";
const CAROL_ADMIN = "90000000-0000-4000-8000-eeee00000001";
const ALICE_ORG = "90000000-0000-4000-8000-cccc00000001";

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

let db: TestDb | null = null;
let rlsReady = false;
let aliceCaseId = "";

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
    { id: ALICE, name: "Test Alice REC", email: "rec-alice@docket.local" },
    { id: CAROL_ADMIN, name: "Test Carol REC", email: "rec-carol@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ALICE, role: "attorney" },
    { userId: CAROL_ADMIN, role: "admin" },
  ]);
  await db.insert(organizations).values({
    id: ALICE_ORG,
    name: "Alice Org REC",
    slug: "rec-alice-org",
  });
  await db.insert(organizationMembers).values({
    organizationId: ALICE_ORG,
    userId: ALICE,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
});

beforeEach(async () => {
  if (!db) return;
  await db.execute(
    sql`delete from cases where organization_id = ${ALICE_ORG}`,
  );
  const a = await callAs(ALICE).case.create({ visaType: "O-1A" });
  aliceCaseId = a.id;
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("recommender — admin participant gate", () => {
  it("list returns [] for an admin not on the case", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseRecommenders).values({
      caseId: aliceCaseId,
      displayOrder: 0,
      fullName: "Rec One",
      relationship: "Advisor",
    });

    const r = await callAs(CAROL_ADMIN).recommender.list({
      caseId: aliceCaseId,
    });
    expect(r).toEqual([]);
  });

  it("create NOT_FOUND for an admin not on the case", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(CAROL_ADMIN).recommender.create({
        caseId: aliceCaseId,
        data: { fullName: "Forged Rec", relationship: "Advisor" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("update NOT_FOUND for an admin not on the case", async (ctx) => {
    const d = gate(ctx);
    const [rec] = await d
      .insert(caseRecommenders)
      .values({
        caseId: aliceCaseId,
        displayOrder: 0,
        fullName: "Rec Original",
        relationship: "Advisor",
      })
      .returning({ id: caseRecommenders.id });

    await expect(
      callAs(CAROL_ADMIN).recommender.update({
        recommenderId: rec!.id,
        patch: { fullName: "Forged Update" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("remove NOT_FOUND for an admin not on the case", async (ctx) => {
    const d = gate(ctx);
    const [rec] = await d
      .insert(caseRecommenders)
      .values({
        caseId: aliceCaseId,
        displayOrder: 0,
        fullName: "Rec To Keep",
        relationship: "Advisor",
      })
      .returning({ id: caseRecommenders.id });

    await expect(
      callAs(CAROL_ADMIN).recommender.remove({ recommenderId: rec!.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Confirm the row was NOT actually soft-deleted.
    const [still] = await d
      .select({ deletedAt: caseRecommenders.deletedAt })
      .from(caseRecommenders)
      .where(eq(caseRecommenders.id, rec!.id));
    expect(still?.deletedAt).toBeNull();
  });

  it("reorder NOT_FOUND for an admin not on the case", async (ctx) => {
    const d = gate(ctx);
    const inserted = await d
      .insert(caseRecommenders)
      .values([
        {
          caseId: aliceCaseId,
          displayOrder: 0,
          fullName: "Rec A",
          relationship: "Advisor",
        },
        {
          caseId: aliceCaseId,
          displayOrder: 1,
          fullName: "Rec B",
          relationship: "Co-author",
        },
      ])
      .returning({ id: caseRecommenders.id });

    await expect(
      callAs(CAROL_ADMIN).recommender.reorder({
        caseId: aliceCaseId,
        orderedIds: [inserted[1]!.id, inserted[0]!.id],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an admin added as a participant CAN list and create", async (ctx) => {
    const d = gate(ctx);
    // Add Carol as an observer participant.
    await d.execute(
      sql`insert into case_participants (case_id, user_id, role, is_primary)
          values (${aliceCaseId}, ${CAROL_ADMIN}, 'observer', false)`,
    );

    const empty = await callAs(CAROL_ADMIN).recommender.list({
      caseId: aliceCaseId,
    });
    expect(empty).toEqual([]);

    const r = await callAs(CAROL_ADMIN).recommender.create({
      caseId: aliceCaseId,
      data: { fullName: "Carol's Rec", relationship: "Advisor" },
    });
    expect(r.ok).toBe(true);
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(
    sql`delete from cases where organization_id = ${ALICE_ORG}`,
  );
  await d.execute(
    sql`delete from organization_members where organization_id = ${ALICE_ORG}`,
  );
  await d.execute(sql`delete from organizations where id = ${ALICE_ORG}`);
  await d.execute(
    sql`delete from user_roles where user_id in (${ALICE}, ${CAROL_ADMIN})`,
  );
  await d.execute(
    sql`delete from users where id in (${ALICE}, ${CAROL_ADMIN})`,
  );
}
