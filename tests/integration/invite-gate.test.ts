// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { auditLog, userRoles, users, waitlistEntries } from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import { isInvitePermitted } from "@/server/auth/invite-gate";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * Integration tests for the invite gate (Stage 03 hardening).
 *
 * Two surfaces:
 *   1. `isInvitePermitted()` — the gate function the Auth.js `signIn`
 *      callback consults on every OAuth attempt.
 *   2. `admin.listWaitlist` + `admin.approveWaitlistEntry` — the admin UI
 *      surface that flips waitlist rows to approved.
 */

const ADMIN = "90000000-0000-4000-8000-aaaa00000001";
const NON_ADMIN = "90000000-0000-4000-8000-bbbb00000001";
const RETURNING_USER = "90000000-0000-4000-8000-cccc00000001";

const ADMIN_EMAIL = "invite-gate-admin@docket.local";
const NON_ADMIN_EMAIL = "invite-gate-non-admin@docket.local";
const RETURNING_EMAIL = "invite-gate-returning@docket.local";
const APPROVED_EMAIL = "invite-gate-approved@docket.local";
const PENDING_EMAIL = "invite-gate-pending@docket.local";
const STRANGER_EMAIL = "invite-gate-stranger@docket.local";

const ALL_TEST_EMAILS = [
  ADMIN_EMAIL,
  NON_ADMIN_EMAIL,
  RETURNING_EMAIL,
  APPROVED_EMAIL,
  PENDING_EMAIL,
  STRANGER_EMAIL,
];

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
    { id: ADMIN, name: "Invite Gate Admin", email: ADMIN_EMAIL },
    { id: NON_ADMIN, name: "Invite Gate Non-Admin", email: NON_ADMIN_EMAIL },
    { id: RETURNING_USER, name: "Returning User", email: RETURNING_EMAIL },
  ]);
  await db.insert(userRoles).values([
    { userId: ADMIN, role: "admin" },
    { userId: NON_ADMIN, role: "attorney" },
    { userId: RETURNING_USER, role: "attorney" },
  ]);
});

beforeEach(async () => {
  if (!db) return;
  // Reset waitlist + audit log entries this suite owns. Leave the user
  // rows in place so RETURNING_USER stays present across tests.
  await db
    .delete(waitlistEntries)
    .where(inArray(waitlistEntries.email, ALL_TEST_EMAILS));
  await db
    .delete(auditLog)
    .where(eq(auditLog.action, "waitlist.approve"));
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("isInvitePermitted", () => {
  it("allows returning users (already in `users` table)", async (ctx) => {
    gate(ctx);
    expect(await isInvitePermitted(RETURNING_EMAIL)).toBe(true);
  });

  it("allows returning users case-insensitively (citext column)", async (ctx) => {
    gate(ctx);
    expect(
      await isInvitePermitted(RETURNING_EMAIL.toUpperCase()),
    ).toBe(true);
  });

  it("allows new emails on the approved waitlist", async (ctx) => {
    const d = gate(ctx);
    await d.insert(waitlistEntries).values({
      email: APPROVED_EMAIL,
      approvedAt: new Date(),
      approvedBy: ADMIN,
    });
    expect(await isInvitePermitted(APPROVED_EMAIL)).toBe(true);
  });

  it("rejects emails on the waitlist that have not been approved", async (ctx) => {
    const d = gate(ctx);
    await d.insert(waitlistEntries).values({ email: PENDING_EMAIL });
    expect(await isInvitePermitted(PENDING_EMAIL)).toBe(false);
  });

  it("rejects emails not on the waitlist at all", async (ctx) => {
    gate(ctx);
    expect(await isInvitePermitted(STRANGER_EMAIL)).toBe(false);
  });

  it("rejects soft-deleted approved entries", async (ctx) => {
    const d = gate(ctx);
    await d.insert(waitlistEntries).values({
      email: APPROVED_EMAIL,
      approvedAt: new Date(),
      approvedBy: ADMIN,
      deletedAt: new Date(),
    });
    expect(await isInvitePermitted(APPROVED_EMAIL)).toBe(false);
  });

  it("rejects empty / missing email defensively", async (ctx) => {
    gate(ctx);
    expect(await isInvitePermitted("")).toBe(false);
  });
});


describe("admin.listWaitlist", () => {
  it("returns all entries newest-first with approver email joined", async (ctx) => {
    const d = gate(ctx);
    await d.insert(waitlistEntries).values([
      { email: PENDING_EMAIL, createdAt: new Date(Date.now() - 60_000) },
      {
        email: APPROVED_EMAIL,
        approvedAt: new Date(),
        approvedBy: ADMIN,
      },
    ]);

    const data = await callAs(ADMIN).admin.listWaitlist();
    expect(data.items.length).toBeGreaterThanOrEqual(2);
    const ours = data.items.filter((r) =>
      ALL_TEST_EMAILS.includes(r.email),
    );
    expect(ours[0]?.email).toBe(APPROVED_EMAIL);
    expect(ours[0]?.approvedByEmail).toBe(ADMIN_EMAIL);
    expect(ours[1]?.email).toBe(PENDING_EMAIL);
    expect(ours[1]?.approvedAt).toBeNull();
    expect(ours[1]?.approvedByEmail).toBeNull();
    expect(data.totals.total).toBeGreaterThanOrEqual(2);
  });

  it("hides soft-deleted entries", async (ctx) => {
    const d = gate(ctx);
    await d.insert(waitlistEntries).values({
      email: PENDING_EMAIL,
      deletedAt: new Date(),
    });
    const data = await callAs(ADMIN).admin.listWaitlist();
    expect(data.items.find((r) => r.email === PENDING_EMAIL)).toBeUndefined();
  });

  it("rejects non-admin callers", async (ctx) => {
    gate(ctx);
    await expect(callAs(NON_ADMIN).admin.listWaitlist()).rejects.toThrow(
      /admin role required/i,
    );
  });

  it("paginates via cursor, returning nextCursor when more rows exist", async (ctx) => {
    const d = gate(ctx);
    // Insert 27 entries across two pages (page size = 25).
    const rows = Array.from({ length: 27 }, (_, i) => ({
      email: `wl-pagination-${i.toString().padStart(2, "0")}@docket.local`,
      name: `WL ${i}`,
    }));
    await d.insert(waitlistEntries).values(rows);

    const page1 = await callAs(ADMIN).admin.listWaitlist();
    expect(page1.items.length).toBe(25);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.totals.total).toBeGreaterThanOrEqual(27);

    const page2 = await callAs(ADMIN).admin.listWaitlist({
      cursor: page1.nextCursor!,
    });
    // Remaining 2 of our seed (plus any leftovers from prior tests in
    // this beforeEach), but at least our 2.
    expect(page2.items.length).toBeGreaterThanOrEqual(2);
    expect(page2.nextCursor).toBeNull();

    // No overlap between pages.
    const page1Ids = new Set(page1.items.map((i) => i.id));
    const overlap = page2.items.filter((i) => page1Ids.has(i.id));
    expect(overlap).toEqual([]);
  });
});

describe("admin.approveWaitlistEntry", () => {
  it("flips approved_at + approved_by and writes an audit log row", async (ctx) => {
    const d = gate(ctx);
    const [entry] = await d
      .insert(waitlistEntries)
      .values({ email: PENDING_EMAIL })
      .returning({ id: waitlistEntries.id });

    const result = await callAs(ADMIN).admin.approveWaitlistEntry({
      entryId: entry!.id,
    });
    expect(result.ok).toBe(true);

    const [row] = await d
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.id, entry!.id));
    expect(row?.approvedAt).not.toBeNull();
    expect(row?.approvedBy).toBe(ADMIN);

    const audits = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "waitlist.approve"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorUserId).toBe(ADMIN);
    expect(audits[0]?.targetType).toBe("waitlist_entry");
    expect(audits[0]?.targetId).toBe(entry!.id);

    // The newly-approved email now passes the gate.
    expect(await isInvitePermitted(PENDING_EMAIL)).toBe(true);
  });

  it("returns CONFLICT when the entry is already approved", async (ctx) => {
    const d = gate(ctx);
    const [entry] = await d
      .insert(waitlistEntries)
      .values({
        email: APPROVED_EMAIL,
        approvedAt: new Date(),
        approvedBy: ADMIN,
      })
      .returning({ id: waitlistEntries.id });

    await expect(
      callAs(ADMIN).admin.approveWaitlistEntry({ entryId: entry!.id }),
    ).rejects.toThrow(/already approved/i);

    // No second audit entry written.
    const audits = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "waitlist.approve"));
    expect(audits).toHaveLength(0);
  });

  it("returns NOT_FOUND for unknown entry id", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ADMIN).admin.approveWaitlistEntry({
        entryId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("treats soft-deleted entries as NOT_FOUND", async (ctx) => {
    const d = gate(ctx);
    const [entry] = await d
      .insert(waitlistEntries)
      .values({ email: PENDING_EMAIL, deletedAt: new Date() })
      .returning({ id: waitlistEntries.id });

    await expect(
      callAs(ADMIN).admin.approveWaitlistEntry({ entryId: entry!.id }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects non-admin callers", async (ctx) => {
    const d = gate(ctx);
    const [entry] = await d
      .insert(waitlistEntries)
      .values({ email: PENDING_EMAIL })
      .returning({ id: waitlistEntries.id });

    await expect(
      callAs(NON_ADMIN).admin.approveWaitlistEntry({ entryId: entry!.id }),
    ).rejects.toThrow(/admin role required/i);
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d
    .delete(auditLog)
    .where(eq(auditLog.action, "waitlist.approve"));
  await d
    .delete(waitlistEntries)
    .where(inArray(waitlistEntries.email, ALL_TEST_EMAILS));
  // Drop user_roles + users for our seeded ids. CASCADE handles user_roles
  // (and any other rows FK'd to users.id with ON DELETE CASCADE).
  const ids = [ADMIN, NON_ADMIN, RETURNING_USER];
  await d.delete(userRoles).where(inArray(userRoles.userId, ids));
  await d.delete(users).where(inArray(users.id, ids));
}
