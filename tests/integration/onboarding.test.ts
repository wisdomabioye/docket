// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { onSignIn } from "@/server/auth/onboarding";
import { closeTestDb, getTestDb, type TestDb } from "../helpers/db";

/**
 * Integration tests for `onSignIn()` — the auto-provisioning that runs
 * after Auth.js confirms a successful sign-in. Talks to the real DB; uses
 * the owner connection (no GUC) since onboarding itself runs as system
 * code.
 *
 * Skips cleanly when DATABASE_URL isn't set.
 */

const USER_NEW = "10000000-0000-4000-8000-aaaa00000001";
const USER_PARTIAL = "10000000-0000-4000-8000-aaaa00000002";
const USER_REPEAT = "10000000-0000-4000-8000-aaaa00000003";
const USER_NULL_NAME = "10000000-0000-4000-8000-aaaa00000004";

const ALL_TEST_USERS = [USER_NEW, USER_PARTIAL, USER_REPEAT, USER_NULL_NAME];

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
  await wipe(db);
  await db.insert(users).values([
    { id: USER_NEW, name: "Test New", email: "onboard-new@docket.local" },
    { id: USER_PARTIAL, name: "Test Partial", email: "onboard-partial@docket.local" },
    { id: USER_REPEAT, name: "Test Repeat", email: "onboard-repeat@docket.local" },
    { id: USER_NULL_NAME, name: null, email: "onboard-null@docket.local" },
  ]);
});

afterEach(async () => {
  if (db) await wipeProvisioned(db);
});

afterAll(async () => {
  if (db) await wipe(db);
  await closeTestDb();
});

describe("onSignIn", () => {
  it("creates org + member + role + profile on first sign-in", async (ctx) => {
    const db = gate(ctx);
    await onSignIn({ userId: USER_NEW, isNewUser: true });

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_NEW));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");
    expect(memberships[0]?.status).toBe("active");

    const roles = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, USER_NEW));
    expect(roles.map((r) => r.role)).toContain("attorney");

    const [profile] = await db
      .select()
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, USER_NEW));
    expect(profile?.status).toBe("pending");

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, memberships[0]!.organizationId));
    expect(org?.name).toBe("Test New's Practice");
    expect(org?.slug).toMatch(/^onboard-new-[a-z0-9]{6}$/);
  });

  it("uses 'My Practice' when user.name is null", async (ctx) => {
    const db = gate(ctx);
    await onSignIn({ userId: USER_NULL_NAME, isNewUser: true });

    const [m] = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_NULL_NAME));
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, m!.organizationId));
    expect(org?.name).toBe("My Practice");
  });

  it("is idempotent — re-running creates no duplicates", async (ctx) => {
    const db = gate(ctx);
    await onSignIn({ userId: USER_REPEAT, isNewUser: true });
    await onSignIn({ userId: USER_REPEAT, isNewUser: false });
    await onSignIn({ userId: USER_REPEAT, isNewUser: false });

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_REPEAT));
    expect(memberships).toHaveLength(1);

    const profiles = await db
      .select()
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, USER_REPEAT));
    expect(profiles).toHaveLength(1);

    const roles = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, USER_REPEAT));
    expect(roles).toHaveLength(1);
  });

  it("repairs partial state — missing role + profile after first attempt", async (ctx) => {
    const db = gate(ctx);
    // Simulate a previous sign-in that created org+member then crashed
    // before role/profile inserts.
    await onSignIn({ userId: USER_PARTIAL, isNewUser: true });
    await db
      .delete(userRoles)
      .where(eq(userRoles.userId, USER_PARTIAL));
    await db
      .delete(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, USER_PARTIAL));

    // Subsequent sign-in should restore them.
    await onSignIn({ userId: USER_PARTIAL, isNewUser: false });

    const roles = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, USER_PARTIAL));
    expect(roles).toHaveLength(1);

    const [profile] = await db
      .select()
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, USER_PARTIAL));
    expect(profile?.status).toBe("pending");

    // And no second org was created.
    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_PARTIAL));
    expect(memberships).toHaveLength(1);
  });

  it("returns silently if the user row doesn't exist (adapter race)", async (ctx) => {
    gate(ctx);
    const ghostId = "10000000-0000-4000-8000-aaaa00009999";
    await expect(
      onSignIn({ userId: ghostId, isNewUser: true }),
    ).resolves.not.toThrow();
  });

  it("never creates a duplicate org for the same user even on concurrent calls", async (ctx) => {
    const db = gate(ctx);
    // Fire several concurrent sign-ins. Race-condition smoke test for the
    // "find existing membership first" guard inside the transaction.
    await Promise.all([
      onSignIn({ userId: USER_NEW, isNewUser: false }),
      onSignIn({ userId: USER_NEW, isNewUser: false }),
      onSignIn({ userId: USER_NEW, isNewUser: false }),
    ]);
    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_NEW));
    expect(memberships).toHaveLength(1);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

async function wipeProvisioned(db: TestDb): Promise<void> {
  // Membership/role/profile keyed on userId; orgs found via membership.
  const memberships = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(
      sql`${organizationMembers.userId} = any(${sql.raw(`array[${ALL_TEST_USERS.map((u) => `'${u}'::uuid`).join(",")}]`)})`,
    );
  await db
    .delete(attorneyProfiles)
    .where(
      sql`${attorneyProfiles.userId} = any(${sql.raw(`array[${ALL_TEST_USERS.map((u) => `'${u}'::uuid`).join(",")}]`)})`,
    );
  await db
    .delete(userRoles)
    .where(
      sql`${userRoles.userId} = any(${sql.raw(`array[${ALL_TEST_USERS.map((u) => `'${u}'::uuid`).join(",")}]`)})`,
    );
  await db
    .delete(organizationMembers)
    .where(
      sql`${organizationMembers.userId} = any(${sql.raw(`array[${ALL_TEST_USERS.map((u) => `'${u}'::uuid`).join(",")}]`)})`,
    );
  if (memberships.length) {
    const orgIds = memberships.map((m) => `'${m.orgId}'::uuid`).join(",");
    await db.execute(sql.raw(`delete from organizations where id = any(array[${orgIds}])`));
  }
}

async function wipe(db: TestDb): Promise<void> {
  await wipeProvisioned(db);
  await db.execute(
    sql.raw(
      `delete from users where id = any(array[${ALL_TEST_USERS.map((u) => `'${u}'::uuid`).join(",")}])`,
    ),
  );
}
