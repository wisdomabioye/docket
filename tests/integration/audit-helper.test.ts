// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, userRoles, users } from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";
import {
  latestActionFor,
  listAuditLog,
  logAdminAction,
  withAudit,
} from "@/server/services/audit";

/**
 * Stage 09 Phase A — audit helper coverage. Tests run against the real
 * test DB so the audit_log row insert + query path is exercised
 * end-to-end.
 *
 * Branches under test:
 *   - logAdminAction: inserts a row with the correct shape; null
 *     details / null targetId omitted from the values object.
 *   - withAudit: writes the log on success; does NOT write on failure;
 *     re-throws the original error untouched.
 *   - listAuditLog: pagination, actor filter, action prefix filter.
 *   - latestActionFor: returns the most recent matching event or null.
 */

const ADMIN = "ce000000-0000-4000-8000-aaaa00000001";
const ANOTHER_ADMIN = "ce000000-0000-4000-8000-aaaa00000002";

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
});

beforeEach(async () => {
  if (!db) return;
  await truncateAllAppTables(db);
  await db.insert(users).values([
    { id: ADMIN, name: "Audit Admin", email: "audit-admin@docket.local" },
    {
      id: ANOTHER_ADMIN,
      name: "Audit Admin 2",
      email: "audit-admin-2@docket.local",
    },
  ]);
  await db.insert(userRoles).values([
    { userId: ADMIN, role: "admin" },
    { userId: ANOTHER_ADMIN, role: "admin" },
  ]);
});

afterAll(async () => {
  await closeTestDb();
});

describe("logAdminAction", () => {
  it("inserts a row with action + targetType + actor", async (ctx) => {
    const d = gate(ctx);
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "test.helper",
      targetType: "system",
      details: { foo: "bar" },
    });
    const [row] = await d
      .select({
        action: auditLog.action,
        actorType: auditLog.actorType,
        actorUserId: auditLog.actorUserId,
        targetType: auditLog.targetType,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(eq(auditLog.action, "test.helper"));
    expect(row?.actorType).toBe("user");
    expect(row?.actorUserId).toBe(ADMIN);
    expect(row?.targetType).toBe("system");
    expect(row?.details).toMatchObject({ foo: "bar" });
  });

  it("accepts null targetId + null details (omitted from insert)", async (ctx) => {
    const d = gate(ctx);
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "test.no_target",
      targetType: "system",
      targetId: null,
      details: null,
    });
    const [row] = await d
      .select({
        targetId: auditLog.targetId,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(eq(auditLog.action, "test.no_target"));
    expect(row?.targetId).toBeNull();
    expect(row?.details).toBeNull();
  });
});

describe("withAudit — success", () => {
  it("writes the log row AFTER the wrapped function resolves", async (ctx) => {
    const d = gate(ctx);
    const order: string[] = [];
    const result = await withAudit(
      {
        db: d as never,
        adminId: ADMIN,
        action: "test.success",
        targetType: "system",
        detailsFrom: (r: { value: number }) => ({ resolvedTo: r.value }),
      },
      async () => {
        order.push("inner");
        return { value: 42 };
      },
    );
    expect(result).toEqual({ value: 42 });
    expect(order).toEqual(["inner"]);

    const [row] = await d
      .select({
        action: auditLog.action,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(eq(auditLog.action, "test.success"));
    expect(row?.details).toMatchObject({ resolvedTo: 42 });
  });

  it("derives details from the resolved value (not the input)", async (ctx) => {
    const d = gate(ctx);
    await withAudit(
      {
        db: d as never,
        adminId: ADMIN,
        action: "test.derived_details",
        targetType: "system",
        detailsFrom: (r) => ({ rowsTouched: r as number }),
      },
      async () => 7,
    );
    const [row] = await d
      .select({ details: auditLog.details })
      .from(auditLog)
      .where(eq(auditLog.action, "test.derived_details"));
    expect(row?.details).toMatchObject({ rowsTouched: 7 });
  });
});

describe("withAudit — failure", () => {
  it("does NOT write a log row when the wrapped function throws", async (ctx) => {
    const d = gate(ctx);
    await expect(
      withAudit(
        {
          db: d as never,
          adminId: ADMIN,
          action: "test.failure",
          targetType: "system",
        },
        async () => {
          throw new Error("simulated failure");
        },
      ),
    ).rejects.toThrow(/simulated failure/);

    const rows = await d
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.action, "test.failure"));
    expect(rows).toHaveLength(0);
  });

  it("re-throws the same error class (no swallowing or wrapping)", async (ctx) => {
    const d = gate(ctx);
    class CustomError extends Error {}
    await expect(
      withAudit(
        {
          db: d as never,
          adminId: ADMIN,
          action: "test.custom_err",
          targetType: "system",
        },
        async () => {
          throw new CustomError("custom");
        },
      ),
    ).rejects.toBeInstanceOf(CustomError);
  });
});

describe("listAuditLog", () => {
  it("returns rows newest-first with actor email joined", async (ctx) => {
    const d = gate(ctx);
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "test.first",
      targetType: "system",
    });
    await new Promise((r) => setTimeout(r, 5));
    await logAdminAction({
      db: d as never,
      adminId: ANOTHER_ADMIN,
      action: "test.second",
      targetType: "system",
    });
    const r = await listAuditLog({ db: d as never });
    expect(r.items[0]?.action).toBe("test.second");
    expect(r.items[0]?.actorEmail).toBe("audit-admin-2@docket.local");
    expect(r.items[1]?.action).toBe("test.first");
  });

  it("filters by actorId", async (ctx) => {
    const d = gate(ctx);
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "test.a",
      targetType: "system",
    });
    await logAdminAction({
      db: d as never,
      adminId: ANOTHER_ADMIN,
      action: "test.b",
      targetType: "system",
    });
    const r = await listAuditLog({ db: d as never, actorId: ADMIN });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.action).toBe("test.a");
  });

  it("filters by actionPrefix", async (ctx) => {
    const d = gate(ctx);
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "attorney.activate",
      targetType: "user",
    });
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "attorney.suspend",
      targetType: "user",
    });
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "waitlist.approve",
      targetType: "waitlist_entry",
    });
    const r = await listAuditLog({
      db: d as never,
      actionPrefix: "attorney.",
    });
    expect(r.items).toHaveLength(2);
    expect(r.items.every((i) => i.action.startsWith("attorney."))).toBe(true);
  });

  it("paginates with keyset cursor", async (ctx) => {
    const d = gate(ctx);
    for (let i = 0; i < 5; i++) {
      await logAdminAction({
        db: d as never,
        adminId: ADMIN,
        action: `test.page_${i}`,
        targetType: "system",
      });
      await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await listAuditLog({ db: d as never, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listAuditLog({
      db: d as never,
      pageSize: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(2);
    // Page 1 + page 2 cover 4 distinct rows (no overlap).
    const ids = new Set([
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
    ]);
    expect(ids.size).toBe(4);
  });
});

describe("latestActionFor", () => {
  it("returns the most recent event for the (targetType, targetId) pair", async (ctx) => {
    const d = gate(ctx);
    await logAdminAction({
      db: d as never,
      adminId: ADMIN,
      action: "test.older",
      targetType: "user",
      targetId: ADMIN,
    });
    await new Promise((r) => setTimeout(r, 5));
    await logAdminAction({
      db: d as never,
      adminId: ANOTHER_ADMIN,
      action: "test.newer",
      targetType: "user",
      targetId: ADMIN,
    });
    const latest = await latestActionFor({
      db: d as never,
      targetType: "user",
      targetId: ADMIN,
    });
    expect(latest?.action).toBe("test.newer");
    expect(latest?.actorEmail).toBe("audit-admin-2@docket.local");
  });

  it("returns null when no matching events exist", async (ctx) => {
    const d = gate(ctx);
    const latest = await latestActionFor({
      db: d as never,
      targetType: "user",
      targetId: "00000000-0000-4000-8000-000000000000",
    });
    expect(latest).toBeNull();
  });
});
