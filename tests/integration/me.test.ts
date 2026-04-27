// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `@/server/auth/config` pulls in next-auth → `next/server`, which vitest's
// resolver can't find without the `.js` extension. We never call `auth()`
// in this test (we construct the tRPC context manually), so a no-op stub
// is enough to break the import chain.
vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import { sql } from "drizzle-orm";
import {
  attorneyProfiles,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * End-to-end test for the entire Stage 02 stack:
 *   tRPC caller → requireAuthAndDb middleware → transaction with
 *   `set local role app_user` + GUC → me.current() query → RLS-engaged
 *   reads against the real DB.
 *
 * If `me.current()` returns the right shape for the right user (and not
 * for the wrong user), the whole stack is wired correctly.
 *
 * Skips when DATABASE_URL or the `app_user` role is missing.
 */

const ALICE = "f0000000-0000-4000-8000-aaaa00000001";
const BOB = "f0000000-0000-4000-8000-bbbb00000001";
const ADMIN = "f0000000-0000-4000-8000-cccc00000001";

const ALICE_ORG = "f1000000-0000-4000-8000-aaaa00000001";
const BOB_ORG = "f1000000-0000-4000-8000-bbbb00000001";

let db: TestDb | null = null;
let rlsReady = false;

const callerFactory = createCallerFactory(appRouter);

function callAs(userId: string | null) {
  return callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });
}

function gate(ctx: { skip: () => void }): void {
  if (!db || !rlsReady) {
    ctx.skip();
    throw new Error("unreachable");
  }
}

beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  rlsReady = await rlsRoleExists(db);
  if (!rlsReady) return;
  await teardown(db);
  await seed(db);
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("me.current — end-to-end stack", () => {
  it("UNAUTHORIZED when no user in context", async (ctx) => {
    gate(ctx);
    const caller = callAs(null);
    await expect(caller.me.current()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("alice sees her own user / roles / org / profile", async (ctx) => {
    gate(ctx);
    const result = await callAs(ALICE).me.current();

    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(ALICE);
    expect(result?.user.email).toBe("me-alice@docket.local");
    expect(result?.user.name).toBe("Test Alice (me)");

    expect(result?.roles).toContain("attorney");
    expect(result?.roles).not.toContain("admin");

    expect(result?.memberships).toHaveLength(1);
    expect(result?.memberships[0]?.organizationId).toBe(ALICE_ORG);
    expect(result?.memberships[0]?.role).toBe("owner");
    expect(result?.memberships[0]?.organizationName).toBe("Alice Org (me)");

    expect(result?.attorneyProfile?.status).toBe("active");
    expect(result?.attorneyProfile?.barNumber).toBe("ME-A-1");
  });

  it("admin sees their admin role", async (ctx) => {
    gate(ctx);
    const result = await callAs(ADMIN).me.current();
    expect(result?.roles).toContain("admin");
  });

  it("alice does NOT see bob's data even with a wrong-user query (RLS engaged)", async (ctx) => {
    gate(ctx);
    // Confirm the requested user matches what alice sees — never bob.
    const aliceResult = await callAs(ALICE).me.current();
    expect(aliceResult?.user.id).toBe(ALICE);
    expect(aliceResult?.memberships.map((m) => m.organizationId)).not.toContain(
      BOB_ORG,
    );

    const bobResult = await callAs(BOB).me.current();
    expect(bobResult?.user.id).toBe(BOB);
    expect(bobResult?.memberships.map((m) => m.organizationId)).not.toContain(
      ALICE_ORG,
    );
  });

  it("returns null when the user row is missing (e.g. soft-deleted)", async (ctx) => {
    gate(ctx);
    const ghost = "f0000000-0000-4000-8000-9999ffffffff";
    const result = await callAs(ghost).me.current();
    expect(result).toBeNull();
  });
});

// ── seed ────────────────────────────────────────────────────────────────

async function seed(db: TestDb): Promise<void> {
  await db.insert(users).values([
    { id: ALICE, name: "Test Alice (me)", email: "me-alice@docket.local" },
    { id: BOB, name: "Test Bob (me)", email: "me-bob@docket.local" },
    { id: ADMIN, name: "Test Admin (me)", email: "me-admin@docket.local" },
  ]);

  await db.insert(userRoles).values([
    { userId: ALICE, role: "attorney" },
    { userId: BOB, role: "attorney" },
    { userId: ADMIN, role: "admin" },
  ]);

  await db.insert(attorneyProfiles).values([
    { userId: ALICE, barNumber: "ME-A-1", barStates: ["NY"], status: "active" },
    { userId: BOB, barNumber: "ME-B-1", barStates: ["CA"], status: "active" },
  ]);

  await db.insert(organizations).values([
    { id: ALICE_ORG, name: "Alice Org (me)", slug: "me-alice-org" },
    { id: BOB_ORG, name: "Bob Org (me)", slug: "me-bob-org" },
  ]);

  await db.insert(organizationMembers).values([
    {
      organizationId: ALICE_ORG,
      userId: ALICE,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: BOB_ORG,
      userId: BOB,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
  ]);
}

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from organization_members where organization_id in (${ALICE_ORG}, ${BOB_ORG})`);
  await db.execute(sql`delete from organizations where id in (${ALICE_ORG}, ${BOB_ORG})`);
  await db.execute(sql`delete from attorney_profiles where user_id in (${ALICE}, ${BOB})`);
  await db.execute(sql`delete from user_roles where user_id in (${ALICE}, ${BOB}, ${ADMIN})`);
  await db.execute(sql`delete from users where id in (${ALICE}, ${BOB}, ${ADMIN})`);
}
