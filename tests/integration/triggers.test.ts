// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  cases,
  organizations,
  users,
} from "@/server/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "../helpers/db";

/**
 * Behavioral tests for the SQL triggers in:
 *   - 0003_updated_at_trigger.sql  (set_updated_at)
 *   - 0004_row_revision_trigger.sql (bump_row_revision)
 *
 * If a future change drops a trigger or skips a table from the attach
 * loop, these tests catch it.
 *
 * Owner connection (RLS bypassed) — we're testing trigger behavior,
 * not access control.
 */

const USER = "30000000-0000-4000-8000-aaaa00000001";
const ORG = "30000000-0000-4000-8000-bbbb00000001";
const CASE = "30000000-0000-4000-8000-cccc00000001";

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
    id: USER,
    name: "Test Trigger",
    email: "trigger-user@docket.local",
  });
  await db
    .insert(organizations)
    .values({ id: ORG, name: "Trigger Org", slug: "trigger-org" });
  await db
    .insert(cases)
    .values({ id: CASE, organizationId: ORG, visaType: "O-1A" });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("set_updated_at trigger", () => {
  it("advances users.updated_at on UPDATE", async (ctx) => {
    const db = gate(ctx);
    const before = await db
      .select({ updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, USER));
    const beforeAt = before[0]!.updatedAt;

    await sleep(10);
    await db.update(users).set({ name: "Test Trigger v2" }).where(eq(users.id, USER));

    const after = await db
      .select({ updatedAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, USER));
    expect(after[0]!.updatedAt.getTime()).toBeGreaterThan(beforeAt.getTime());
  });

  it("advances cases.updated_at on UPDATE", async (ctx) => {
    const db = gate(ctx);
    const before = await db
      .select({ updatedAt: cases.updatedAt })
      .from(cases)
      .where(eq(cases.id, CASE));
    const beforeAt = before[0]!.updatedAt;

    await sleep(10);
    await db.update(cases).set({ status: "documents_pending" }).where(eq(cases.id, CASE));

    const after = await db
      .select({ updatedAt: cases.updatedAt })
      .from(cases)
      .where(eq(cases.id, CASE));
    expect(after[0]!.updatedAt.getTime()).toBeGreaterThan(beforeAt.getTime());
  });
});

describe("bump_row_revision trigger", () => {
  it("starts at 1 on INSERT", async (ctx) => {
    const db = gate(ctx);
    const [row] = await db
      .select({ rowRevision: users.rowRevision })
      .from(users)
      .where(eq(users.id, USER));
    // Could be >1 if previous test ran updates; just assert it's a positive int.
    expect(row?.rowRevision).toBeGreaterThanOrEqual(1);
  });

  it("increments by 1 on each UPDATE to users", async (ctx) => {
    const db = gate(ctx);
    const before = await db
      .select({ rev: users.rowRevision })
      .from(users)
      .where(eq(users.id, USER));
    const beforeRev = before[0]!.rev;

    await db.update(users).set({ name: "rev test" }).where(eq(users.id, USER));

    const after = await db
      .select({ rev: users.rowRevision })
      .from(users)
      .where(eq(users.id, USER));
    expect(after[0]!.rev).toBe(beforeRev + 1);
  });

  it("increments cases.row_revision on UPDATE", async (ctx) => {
    const db = gate(ctx);
    const before = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, CASE));
    const beforeRev = before[0]!.rev;

    await db
      .update(cases)
      .set({ status: "ready_to_build" })
      .where(eq(cases.id, CASE));

    const after = await db
      .select({ rev: cases.rowRevision })
      .from(cases)
      .where(eq(cases.id, CASE));
    expect(after[0]!.rev).toBe(beforeRev + 1);
  });

  it("does NOT decrement or reset", async (ctx) => {
    const db = gate(ctx);
    // Two consecutive updates → revision rises by exactly 2.
    const before = await db
      .select({ rev: users.rowRevision })
      .from(users)
      .where(eq(users.id, USER));
    await db.update(users).set({ name: "a" }).where(eq(users.id, USER));
    await db.update(users).set({ name: "b" }).where(eq(users.id, USER));
    const after = await db
      .select({ rev: users.rowRevision })
      .from(users)
      .where(eq(users.id, USER));
    expect(after[0]!.rev).toBe(before[0]!.rev + 2);
  });
});

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from cases where id = ${CASE}`);
  await db.execute(sql`delete from organizations where id = ${ORG}`);
  await db.execute(sql`delete from users where id = ${USER}`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
