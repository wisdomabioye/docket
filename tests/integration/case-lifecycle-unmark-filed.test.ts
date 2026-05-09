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
  auditLog,
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

/**
 * Step 7 — `admin.unmarkFiledCase` operational reverse.
 *
 * Asserts the contract from ADR-006:
 *   - admin success from `filed`: status → delivered, filedAt +
 *     filedReceiptNumber cleared, exactly ONE audit_log row written
 *     with the supplied reason and the prior values captured.
 *   - non-admin caller: FORBIDDEN, no DB writes (case row + audit_log
 *     unchanged).
 *   - admin call from a non-`filed` status: CONFLICT, NO audit row
 *     (the same-tx contract — CONFLICT rolls back the audit insert
 *     too).
 *   - the procedure is exposed on the ADMIN router only — the
 *     attorney router has no `unmarkFiled*` member (covered in the
 *     api-shape snapshot test).
 */

const ADMIN = "f6000000-0000-4000-8000-aaaa00000001";
const ATTORNEY = "f6000000-0000-4000-8000-aaaa00000002";
const ORG = "f6000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f6000000-0000-4000-8000-cccc00000001";

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
    { id: ADMIN, name: "Admin", email: "unmark-admin@docket.local" },
    { id: ATTORNEY, name: "Attorney", email: "unmark-att@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ADMIN, role: "admin" },
    { userId: ATTORNEY, role: "attorney" },
  ]);
  await db.insert(organizations).values({
    id: ORG,
    name: "Unmark Org",
    slug: "unmark-test-org",
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
  await db.execute(sql`delete from audit_log where target_id = ${CASE_ID}`);
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
  status: "filed" | "delivered" | "approved",
  receipt: string | null = null,
): Promise<void> {
  await d.insert(cases).values({
    id: CASE_ID,
    organizationId: ORG,
    visaType: "O-1A",
    status,
    ...(status === "filed"
      ? {
          filedAt: new Date(),
          ...(receipt !== null ? { filedReceiptNumber: receipt } : {}),
        }
      : {}),
  });
  await d.insert(caseParticipants).values({
    caseId: CASE_ID,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
}

async function readCase(d: TestDb): Promise<{
  status: string;
  filedAt: Date | null;
  filedReceiptNumber: string | null;
} | undefined> {
  const [row] = await d
    .select({
      status: cases.status,
      filedAt: cases.filedAt,
      filedReceiptNumber: cases.filedReceiptNumber,
    })
    .from(cases)
    .where(eq(cases.id, CASE_ID));
  return row;
}

async function auditCount(d: TestDb): Promise<number> {
  const rows = await d
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.targetId, CASE_ID));
  return rows.length;
}

describe("admin.unmarkFiledCase (ADR-006 Step 7)", () => {
  it("admin reverse from filed clears columns + writes one audit row", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "filed", "MSC2200000001");

    const result = await callAs(ADMIN).admin.unmarkFiledCase({
      caseId: CASE_ID,
      reason: "Wrong receipt entered — re-marking with correct value.",
    });
    expect(result.ok).toBe(true);

    const row = await readCase(d);
    expect(row?.status).toBe("delivered");
    expect(row?.filedAt).toBeNull();
    expect(row?.filedReceiptNumber).toBeNull();

    expect(await auditCount(d)).toBe(1);
    const [audit] = await d
      .select({
        action: auditLog.action,
        targetType: auditLog.targetType,
        actorUserId: auditLog.actorUserId,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(eq(auditLog.targetId, CASE_ID));
    expect(audit?.action).toBe("case.unmarkFiled");
    expect(audit?.targetType).toBe("case");
    expect(audit?.actorUserId).toBe(ADMIN);
    expect(audit?.details).toMatchObject({
      reason: "Wrong receipt entered — re-marking with correct value.",
      prior_receipt_number: "MSC2200000001",
    });
  });

  it("non-admin caller is FORBIDDEN, no DB writes", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "filed", "MSC1234567890");

    await expect(
      callAs(ATTORNEY).admin.unmarkFiledCase({
        caseId: CASE_ID,
        reason: "Trying to abuse the operational reverse.",
      }),
    ).rejects.toThrow(/admin role required|FORBIDDEN/i);

    // Case row untouched.
    const row = await readCase(d);
    expect(row?.status).toBe("filed");
    expect(row?.filedReceiptNumber).toBe("MSC1234567890");
    // No audit row.
    expect(await auditCount(d)).toBe(0);
  });

  it("admin call from a non-filed status throws CONFLICT and writes NO audit row", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "delivered");

    await expect(
      callAs(ADMIN).admin.unmarkFiledCase({
        caseId: CASE_ID,
        reason: "This should not work — case is not filed yet.",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Case unchanged.
    const row = await readCase(d);
    expect(row?.status).toBe("delivered");
    // CRITICAL: same-tx contract — CONFLICT rolls back the audit
    // insert along with everything else. If this assertion ever
    // fails, the procedure is writing the audit row outside the tx.
    expect(await auditCount(d)).toBe(0);
  });

  it("requires reason ≥ 10 characters", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "filed");

    await expect(
      callAs(ADMIN).admin.unmarkFiledCase({
        caseId: CASE_ID,
        reason: "too short",
      }),
    ).rejects.toThrow();
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(sql`delete from audit_log where target_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from cases where id = ${CASE_ID}`);
  await d.execute(sql`delete from attorney_profiles where user_id = ${ATTORNEY}`);
  await d.execute(
    sql`delete from organization_members where organization_id = ${ORG}`,
  );
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(
    sql`delete from user_roles where user_id in (${ADMIN}, ${ATTORNEY})`,
  );
  await d.execute(
    sql`delete from users where id in (${ADMIN}, ${ATTORNEY})`,
  );
}
