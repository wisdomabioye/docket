// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { cases, organizations } from "@/server/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "../helpers/db";

/**
 * ADR-006 Step 1: lifecycle timestamps + USCIS receipt number.
 *
 * Asserts the migration's contract:
 *   - `package_compiled_at`, `delivered_at`, `filed_receipt_number`
 *      default to NULL on insert (additive, no backfill).
 *   - The partial unique index on `filed_receipt_number` rejects
 *      duplicates on non-null values but allows multiple NULL rows.
 *
 * Owner connection — RLS bypassed.
 */

const ORG = "30000000-0000-4000-8000-aaaa00000001";
const CASE_A = "30000000-0000-4000-8000-cccc00000001";
const CASE_B = "30000000-0000-4000-8000-cccc00000002";
const CASE_C = "30000000-0000-4000-8000-cccc00000003";
const CASE_D = "30000000-0000-4000-8000-cccc00000004";

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
  await db
    .insert(organizations)
    .values({ id: ORG, name: "Lifecycle Org", slug: "lifecycle-cols-test" });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("cases — lifecycle columns (ADR-006)", () => {
  it("defaults package_compiled_at / delivered_at / filed_receipt_number to NULL", async (ctx) => {
    const db = gate(ctx);
    await db
      .insert(cases)
      .values({ id: CASE_A, organizationId: ORG, visaType: "O-1A" });
    const [row] = await db
      .select({
        packageCompiledAt: cases.packageCompiledAt,
        deliveredAt: cases.deliveredAt,
        filedAt: cases.filedAt,
        filedReceiptNumber: cases.filedReceiptNumber,
      })
      .from(cases)
      .where(eq(cases.id, CASE_A));
    expect(row?.packageCompiledAt).toBeNull();
    expect(row?.deliveredAt).toBeNull();
    expect(row?.filedAt).toBeNull();
    expect(row?.filedReceiptNumber).toBeNull();
  });

  it("allows multiple cases with NULL filed_receipt_number", async (ctx) => {
    const db = gate(ctx);
    await db.insert(cases).values([
      { id: CASE_B, organizationId: ORG, visaType: "O-1A" },
      { id: CASE_C, organizationId: ORG, visaType: "O-1A" },
    ]);
    const rows = await db
      .select({ id: cases.id })
      .from(cases)
      .where(sql`${cases.organizationId} = ${ORG} and ${cases.filedReceiptNumber} is null`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects duplicate filed_receipt_number values across cases", async (ctx) => {
    const db = gate(ctx);
    await db
      .update(cases)
      .set({ filedReceiptNumber: "MSC2200000001" })
      .where(eq(cases.id, CASE_B));

    let caught: unknown;
    try {
      await db
        .update(cases)
        .set({ filedReceiptNumber: "MSC2200000001" })
        .where(eq(cases.id, CASE_C));
    } catch (err) {
      caught = err;
    }
    // postgres-js wraps PG errors; the original lives on `.cause`. Code
    // 23505 is the canonical "unique_violation" SQLSTATE.
    const cause =
      caught && typeof caught === "object" && "cause" in caught
        ? (caught as { cause: unknown }).cause
        : caught;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? (cause as { code: unknown }).code
        : undefined;
    expect(code).toBe("23505");
  });

  it("allows the same receipt number to be set after the prior holder is cleared", async (ctx) => {
    const db = gate(ctx);
    // Clear the holder set in the previous test, then reuse the value.
    await db
      .update(cases)
      .set({ filedReceiptNumber: null })
      .where(eq(cases.id, CASE_B));
    await db
      .insert(cases)
      .values({
        id: CASE_D,
        organizationId: ORG,
        visaType: "O-1A",
        filedReceiptNumber: "MSC2200000001",
      });
    const [row] = await db
      .select({ filedReceiptNumber: cases.filedReceiptNumber })
      .from(cases)
      .where(eq(cases.id, CASE_D));
    expect(row?.filedReceiptNumber).toBe("MSC2200000001");
  });
});

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from cases where organization_id = ${ORG}`);
  await db.execute(sql`delete from organizations where id = ${ORG}`);
}
