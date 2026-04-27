// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  auditLog,
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
 * End-to-end tests for the Stage 03 attorney + admin procedures.
 * Verifies onboarding submission, admin activation, role-gated access,
 * and audit-log writes.
 */

const ATTORNEY = "60000000-0000-4000-8000-aaaa00000001";
const ADMIN = "60000000-0000-4000-8000-bbbb00000001";
const NON_ADMIN = "60000000-0000-4000-8000-cccc00000001";
const ORG = "60000000-0000-4000-8000-dddd00000001";

let db: TestDb | null = null;
let rlsReady = false;

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

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
    { id: ATTORNEY, name: "Test Attorney", email: "stage03-attorney@docket.local" },
    { id: ADMIN, name: "Test Admin", email: "stage03-admin@docket.local" },
    { id: NON_ADMIN, name: "Test Non-Admin", email: "stage03-non-admin@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: ADMIN, role: "admin" },
    { userId: NON_ADMIN, role: "attorney" },
  ]);
  await db
    .insert(organizations)
    .values({ id: ORG, name: "Stage 03 Org", slug: "stage03-org" });
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
  // Reset profile state between tests so each starts from a known place.
  await db
    .delete(attorneyProfiles)
    .where(eq(attorneyProfiles.userId, ATTORNEY));
  await db
    .insert(attorneyProfiles)
    .values({ userId: ATTORNEY, status: "pending" });
  await db.execute(sql`delete from audit_log where action = 'attorney.activate' and target_id = ${ATTORNEY}`);
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("attorney.submitOnboarding", () => {
  it("happy path — fills profile and marks submitted_at", async (ctx) => {
    const db = gate(ctx);
    const result = await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "TEST-12345",
      barStates: ["NY", "CA"],
      termsAcceptedVersion: "v1",
      agreementFilename: "agreement.pdf",
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    expect(row?.barNumber).toBe("TEST-12345");
    expect(row?.barStates).toEqual(["NY", "CA"]);
    expect(row?.acceptedTermsVersion).toBe("v1");
    expect(row?.submittedAt).toBeInstanceOf(Date);
    expect(row?.agreementSignedAt).toBeInstanceOf(Date);
    expect(row?.agreementStoragePath).toMatch(/^pending-upload\//);
    expect(row?.status).toBe("pending"); // admin still must activate
  });

  it("rejects empty bar states", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).attorney.submitOnboarding({
        barNumber: "TEST-12345",
        barStates: [],
        termsAcceptedVersion: "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects invalid bar state codes", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).attorney.submitOnboarding({
        barNumber: "TEST",
        barStates: ["NEW YORK"], // length !== 2
        termsAcceptedVersion: "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("CONFLICT when attorney is already active", async (ctx) => {
    const db = gate(ctx);
    await db
      .update(attorneyProfiles)
      .set({ status: "active" })
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    await expect(
      callAs(ATTORNEY).attorney.submitOnboarding({
        barNumber: "TEST",
        barStates: ["NY"],
        termsAcceptedVersion: "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("FORBIDDEN when attorney is suspended", async (ctx) => {
    const db = gate(ctx);
    await db
      .update(attorneyProfiles)
      .set({ status: "suspended" })
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    await expect(
      callAs(ATTORNEY).attorney.submitOnboarding({
        barNumber: "TEST",
        barStates: ["NY"],
        termsAcceptedVersion: "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("FORBIDDEN when attorney is inactive (no infinite redirect)", async (ctx) => {
    const db = gate(ctx);
    await db
      .update(attorneyProfiles)
      .set({ status: "inactive" })
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    await expect(
      callAs(ATTORNEY).attorney.submitOnboarding({
        barNumber: "TEST",
        barStates: ["NY"],
        termsAcceptedVersion: "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a stale or fake termsAcceptedVersion", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).attorney.submitOnboarding({
        barNumber: "TEST",
        barStates: ["NY"],
        // Cast past the literal type to simulate a malicious / stale client.
        termsAcceptedVersion: "v0" as "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes lowercase bar states to uppercase server-side", async (ctx) => {
    const db = gate(ctx);
    const result = await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "TEST-NORM",
      barStates: ["ny", "Ca", "tX"], // mixed-case input
      termsAcceptedVersion: "v1",
      agreementFilename: "x.pdf",
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ barStates: attorneyProfiles.barStates })
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    expect(row?.barStates).toEqual(["NY", "CA", "TX"]);
  });

  it("UNAUTHORIZED when no session", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(null).attorney.submitOnboarding({
        barNumber: "TEST",
        barStates: ["NY"],
        termsAcceptedVersion: "v1",
        agreementFilename: "x.pdf",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("admin.listPendingAttorneys", () => {
  it("FORBIDDEN for non-admin", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.listPendingAttorneys(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns submitted attorneys for admin", async (ctx) => {
    const db = gate(ctx);
    await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "ADMIN-LIST",
      barStates: ["NY"],
      termsAcceptedVersion: "v1",
      agreementFilename: "x.pdf",
    });

    const list = await callAs(ADMIN).admin.listPendingAttorneys();
    const found = list.find((a) => a.userId === ATTORNEY);
    expect(found).toBeDefined();
    expect(found?.barNumber).toBe("ADMIN-LIST");
    void db; // keep gate type-narrow
  });

  it("excludes attorneys who haven't submitted yet", async (ctx) => {
    gate(ctx);
    // beforeEach left ATTORNEY in pending+un-submitted state.
    const list = await callAs(ADMIN).admin.listPendingAttorneys();
    expect(list.find((a) => a.userId === ATTORNEY)).toBeUndefined();
  });

  it("excludes soft-deleted users from the listing", async (ctx) => {
    const db = gate(ctx);
    await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "SOFT-DELETED",
      barStates: ["NY"],
      termsAcceptedVersion: "v1",
      agreementFilename: "x.pdf",
    });
    // Confirm baseline visibility.
    let list = await callAs(ADMIN).admin.listPendingAttorneys();
    expect(list.find((a) => a.userId === ATTORNEY)).toBeDefined();

    // Soft-delete the user row (profile stays intact).
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, ATTORNEY));

    list = await callAs(ADMIN).admin.listPendingAttorneys();
    expect(list.find((a) => a.userId === ATTORNEY)).toBeUndefined();

    // Restore for downstream tests.
    await db
      .update(users)
      .set({ deletedAt: null })
      .where(eq(users.id, ATTORNEY));
  });
});

describe("admin.activateAttorney", () => {
  it("flips status pending → active and writes audit log", async (ctx) => {
    const db = gate(ctx);
    await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "TO-ACTIVATE",
      barStates: ["NY"],
      termsAcceptedVersion: "v1",
      agreementFilename: "x.pdf",
    });

    const result = await callAs(ADMIN).admin.activateAttorney({
      userId: ATTORNEY,
      reason: "credentials verified",
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ status: attorneyProfiles.status })
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, ATTORNEY));
    expect(row?.status).toBe("active");

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, ATTORNEY));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const last = audit[audit.length - 1]!;
    expect(last.action).toBe("attorney.activate");
    expect(last.actorUserId).toBe(ADMIN);
    expect(last.targetType).toBe("user");
    expect(last.details).toEqual({ reason: "credentials verified" });
  });

  it("FORBIDDEN for non-admin", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(NON_ADMIN).admin.activateAttorney({ userId: ATTORNEY }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an empty-string reason at the input boundary", async (ctx) => {
    gate(ctx);
    await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "EMPTY-REASON",
      barStates: ["NY"],
      termsAcceptedVersion: "v1",
      agreementFilename: "x.pdf",
    });
    await expect(
      callAs(ADMIN).admin.activateAttorney({
        userId: ATTORNEY,
        reason: "",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("BAD_REQUEST when target hasn't submitted onboarding", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ADMIN).admin.activateAttorney({ userId: ATTORNEY }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("CONFLICT when target already active", async (ctx) => {
    const db = gate(ctx);
    await callAs(ATTORNEY).attorney.submitOnboarding({
      barNumber: "ALREADY-ACTIVE",
      barStates: ["NY"],
      termsAcceptedVersion: "v1",
      agreementFilename: "x.pdf",
    });
    await db
      .update(attorneyProfiles)
      .set({ status: "active" })
      .where(eq(attorneyProfiles.userId, ATTORNEY));

    await expect(
      callAs(ADMIN).admin.activateAttorney({ userId: ATTORNEY }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("NOT_FOUND for unknown user", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ADMIN).admin.activateAttorney({
        userId: "60000000-0000-4000-8000-9999ffffffff",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function teardown(db: TestDb): Promise<void> {
  await db.execute(
    sql`delete from audit_log where target_id in (${ATTORNEY}, ${ADMIN}, ${NON_ADMIN})`,
  );
  await db.execute(sql`delete from organization_members where organization_id = ${ORG}`);
  await db.execute(sql`delete from organizations where id = ${ORG}`);
  await db.execute(
    sql`delete from attorney_profiles where user_id in (${ATTORNEY}, ${ADMIN}, ${NON_ADMIN})`,
  );
  await db.execute(
    sql`delete from user_roles where user_id in (${ATTORNEY}, ${ADMIN}, ${NON_ADMIN})`,
  );
  await db.execute(
    sql`delete from users where id in (${ATTORNEY}, ${ADMIN}, ${NON_ADMIN})`,
  );
}
