// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  organizationMembers,
  organizations,
  users,
} from "@/server/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "../helpers/db";

// Mock `randomSuffix` to force a slug collision on the first attempt and
// a unique value on the retry. The second user's `ensureOrganization`
// must NOT join the first user's org — it must retry until a unique
// slug succeeds.
const { suffixMock } = vi.hoisted(() => ({ suffixMock: vi.fn() }));
vi.mock("@/server/auth/slug", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/auth/slug")>();
  return { ...real, randomSuffix: suffixMock };
});

import { onSignIn } from "@/server/auth/onboarding";

/**
 * Forces a slug collision and verifies the retry loop generates a fresh
 * slug rather than adopting the existing org. Catches the original
 * security bug — User B becoming owner of User A's org.
 */

const USER_A = "40000000-0000-4000-8000-aaaa00000001";
const USER_B = "40000000-0000-4000-8000-bbbb00000001";

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
  await db.insert(users).values([
    { id: USER_A, name: "Test Collide A", email: "collide-a@docket.local" },
    { id: USER_B, name: "Test Collide B", email: "collide-a@docket.local-other" }, // same local part on purpose
  ]);
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
  vi.restoreAllMocks();
});

describe("onSignIn — slug collision retry", () => {
  it("never joins user B into user A's org on collision", async (ctx) => {
    const db = gate(ctx);

    // User A signs in first — gets suffix "aaaaaa".
    suffixMock.mockReturnValueOnce("aaaaaa");
    await onSignIn({ userId: USER_A, isNewUser: true });

    const [aMember] = await db
      .select({ orgId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_A));
    const aOrgId = aMember!.orgId;
    const [aOrg] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, aOrgId));
    expect(aOrg!.slug).toMatch(/-aaaaaa$/);

    // User B signs in. First suffix attempt collides with A's slug
    // (same email-local part), retry succeeds with "bbbbbb".
    suffixMock
      .mockReturnValueOnce("aaaaaa") // collision
      .mockReturnValueOnce("bbbbbb"); // unique on retry
    await onSignIn({ userId: USER_B, isNewUser: true });

    const [bMember] = await db
      .select({ orgId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_B));

    // Critical assertion — B's org id must NOT match A's.
    expect(bMember!.orgId).not.toBe(aOrgId);

    const [bOrg] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, bMember!.orgId));
    expect(bOrg!.slug).toMatch(/-bbbbbb$/);

    // Each user is sole owner of their own org.
    const aMembers = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, aOrgId));
    expect(aMembers).toHaveLength(1);
    expect(aMembers[0]!.userId).toBe(USER_A);
  });
});

async function teardown(db: TestDb): Promise<void> {
  // Find any orgs created by these users + clean up.
  const memberships = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(
      sql`${organizationMembers.userId} in (${USER_A}, ${USER_B})`,
    );
  await db.execute(
    sql`delete from attorney_profiles where user_id in (${USER_A}, ${USER_B})`,
  );
  await db.execute(
    sql`delete from user_roles where user_id in (${USER_A}, ${USER_B})`,
  );
  await db.execute(
    sql`delete from organization_members where user_id in (${USER_A}, ${USER_B})`,
  );
  for (const m of memberships) {
    await db.execute(sql`delete from organizations where id = ${m.orgId}`);
  }
  await db.execute(sql`delete from users where id in (${USER_A}, ${USER_B})`);
}
