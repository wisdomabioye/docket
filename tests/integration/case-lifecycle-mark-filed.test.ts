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

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * Step 6 — `case.markFiled` lifecycle wiring.
 *
 * Asserts the contract from ADR-006:
 *   - markFiled from `delivered` flips status to `filed`, stamps
 *     `filedAt`, persists optional receipt number.
 *   - markFiled from any non-`delivered` status throws CONFLICT.
 *   - re-markFiled is idempotent: returns `alreadyFiled: true` and
 *     does NOT overwrite the receipt number even if a different one
 *     is supplied.
 *   - cross-case receipt collision throws BAD_REQUEST (the partial
 *     unique index in `0027_lifecycle_columns.sql`).
 *   - exactly one `case.status_changed` event written per real flip.
 */

const ATTORNEY = "f5000000-0000-4000-8000-aaaa00000001";
const ORG = "f5000000-0000-4000-8000-bbbb00000001";
const CASE_A = "f5000000-0000-4000-8000-cccc00000001";
const CASE_B = "f5000000-0000-4000-8000-cccc00000002";

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
    name: "MarkFiled Attorney",
    email: "lifecycle-filed-att@docket.local",
  });
  await db.insert(userRoles).values({ userId: ATTORNEY, role: "attorney" });
  await db.insert(organizations).values({
    id: ORG,
    name: "MarkFiled Org",
    slug: "lifecycle-filed-org",
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
  await db.execute(
    sql`delete from case_events where case_id in (${CASE_A}, ${CASE_B})`,
  );
  await db.execute(
    sql`delete from case_participants where case_id in (${CASE_A}, ${CASE_B})`,
  );
  await db.execute(
    sql`delete from cases where id in (${CASE_A}, ${CASE_B})`,
  );
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

async function seedCase(
  d: TestDb,
  caseId: string,
  status:
    | "approved"
    | "delivered"
    | "filed"
    | "in_review",
): Promise<void> {
  await d.insert(cases).values({
    id: caseId,
    organizationId: ORG,
    visaType: "O-1A",
    status,
  });
  await d.insert(caseParticipants).values({
    caseId,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
}

async function readCase(
  d: TestDb,
  caseId: string,
): Promise<{
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
    .where(eq(cases.id, caseId));
  return row;
}

async function transitionCount(d: TestDb, caseId: string): Promise<number> {
  const events = await d
    .select({ eventType: caseEvents.eventType })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId));
  return events.filter((e) => e.eventType === "case.status_changed").length;
}

describe("case.markFiled (ADR-006 Step 6)", () => {
  it("markFiled from delivered flips to filed and stamps timestamp + receipt", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, CASE_A, "delivered");

    const result = await callAs(ATTORNEY).case.markFiled({
      caseId: CASE_A,
      receiptNumber: "MSC2200000001",
    });
    expect(result.ok).toBe(true);
    expect(result.alreadyFiled).toBe(false);

    const row = await readCase(d, CASE_A);
    expect(row?.status).toBe("filed");
    expect(row?.filedAt).toBeInstanceOf(Date);
    expect(row?.filedReceiptNumber).toBe("MSC2200000001");
    expect(await transitionCount(d, CASE_A)).toBe(1);
  });

  it("markFiled without a receipt is permitted", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, CASE_A, "delivered");

    await callAs(ATTORNEY).case.markFiled({ caseId: CASE_A });

    const row = await readCase(d, CASE_A);
    expect(row?.status).toBe("filed");
    expect(row?.filedReceiptNumber).toBeNull();
  });

  it("markFiled from approved is rejected with CONFLICT", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, CASE_A, "approved");

    await expect(
      callAs(ATTORNEY).case.markFiled({ caseId: CASE_A }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const row = await readCase(d, CASE_A);
    expect(row?.status).toBe("approved");
    expect(row?.filedAt).toBeNull();
  });

  it("idempotent: re-markFiled with a different receipt does NOT overwrite", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, CASE_A, "delivered");

    await callAs(ATTORNEY).case.markFiled({
      caseId: CASE_A,
      receiptNumber: "MSC2200000001",
    });
    const second = await callAs(ATTORNEY).case.markFiled({
      caseId: CASE_A,
      receiptNumber: "MSC9999999999",
    });
    expect(second.alreadyFiled).toBe(true);

    const row = await readCase(d, CASE_A);
    // Receipt unchanged from the first mark.
    expect(row?.filedReceiptNumber).toBe("MSC2200000001");
    // Still exactly one transition event — second call no-op'd.
    expect(await transitionCount(d, CASE_A)).toBe(1);
  });

  it("cross-case receipt collision surfaces as BAD_REQUEST", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, CASE_A, "delivered");
    await seedCase(d, CASE_B, "delivered");

    await callAs(ATTORNEY).case.markFiled({
      caseId: CASE_A,
      receiptNumber: "MSC1111111111",
    });

    await expect(
      callAs(ATTORNEY).case.markFiled({
        caseId: CASE_B,
        receiptNumber: "MSC1111111111",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/already on file/i) as never,
    });

    // Case B left unchanged — tx rolled back on collision.
    const rowB = await readCase(d, CASE_B);
    expect(rowB?.status).toBe("delivered");
    expect(rowB?.filedAt).toBeNull();
    expect(rowB?.filedReceiptNumber).toBeNull();
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(
    sql`delete from case_events where case_id in (${CASE_A}, ${CASE_B})`,
  );
  await d.execute(
    sql`delete from case_participants where case_id in (${CASE_A}, ${CASE_B})`,
  );
  await d.execute(sql`delete from cases where id in (${CASE_A}, ${CASE_B})`);
  await d.execute(sql`delete from attorney_profiles where user_id = ${ATTORNEY}`);
  await d.execute(
    sql`delete from organization_members where organization_id = ${ORG}`,
  );
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(sql`delete from user_roles where user_id = ${ATTORNEY}`);
  await d.execute(sql`delete from users where id = ${ATTORNEY}`);
}
