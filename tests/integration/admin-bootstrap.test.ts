// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  attorneyProfiles,
  auditLog,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

/**
 * Founder bootstrap (`ADMIN_BOOTSTRAP_EMAIL`) tests.
 *
 * The bootstrap helpers read `env.ADMIN_BOOTSTRAP_EMAIL`, and `env.ts`
 * parses `process.env` once at import time. To pin the env var to a known
 * value during this suite without depending on the developer's local
 * `.env.local`, we mock `@/config/env` at file scope so every module that
 * imports it sees the same fixed value.
 *
 * `vi.hoisted` runs BEFORE the file's top-level code so the mock factory
 * (which is also hoisted) can close over the constant — referencing a
 * plain `const` declared later would throw a TDZ error.
 */
const { BOOTSTRAP_EMAIL, NON_MATCH_EMAIL } = vi.hoisted(() => ({
  BOOTSTRAP_EMAIL: "founder-bootstrap@docket.local",
  NON_MATCH_EMAIL: "stranger-bootstrap@docket.local",
}));

vi.mock("@/config/env", () => ({
  env: {
    ADMIN_BOOTSTRAP_EMAIL: BOOTSTRAP_EMAIL,
    // `server/db/client.ts` reads DATABASE_URL at import. Pass through
    // the real value so the test still talks to the dev Postgres.
    DATABASE_URL: process.env.DATABASE_URL,
  },
}));

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

// Stub the welcome-email send so the suite stays hermetic (no Inngest dev
// server on :8288). These tests assert role/profile/audit state, not
// event delivery.
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

import { isInvitePermitted } from "@/server/auth/invite-gate";
import { onSignIn } from "@/server/auth/onboarding";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

const FOUNDER_ID = "a0000000-0000-4000-8000-aaaa00000001";
const STRANGER_ID = "a0000000-0000-4000-8000-bbbb00000001";
const PRE_EXISTING_ADMIN_ID = "a0000000-0000-4000-8000-cccc00000001";
const PRE_EXISTING_ADMIN_EMAIL = "pre-existing-admin@docket.local";

const ALL_IDS = [FOUNDER_ID, STRANGER_ID, PRE_EXISTING_ADMIN_ID];

let db: TestDb | null = null;
let rlsReady = false;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db || !rlsReady) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

// `tests/setup.ts` truncates every app table before this file's
// `beforeAll` runs, so no per-suite wipe/restore of admin rows is needed:
// the test DB starts pristine for each file.
beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  rlsReady = await rlsRoleExists(db);
});

beforeEach(async () => {
  if (!db) return;
  // Per-test reset for the rows our individual cases insert. The global
  // truncate covers cross-file isolation; this covers within-file order
  // independence (each `it` starts from the same blank slate).
  await teardown(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("isInvitePermitted (bootstrap branch)", () => {
  it("permits the env-matched email when no admin exists", async (ctx) => {
    gate(ctx);
    expect(await isInvitePermitted(BOOTSTRAP_EMAIL)).toBe(true);
  });

  it("matches case-insensitively", async (ctx) => {
    gate(ctx);
    expect(await isInvitePermitted(BOOTSTRAP_EMAIL.toUpperCase())).toBe(true);
  });

  it("rejects non-matching emails even when no admin exists", async (ctx) => {
    gate(ctx);
    expect(await isInvitePermitted(NON_MATCH_EMAIL)).toBe(false);
  });

  it("returns false once any admin exists (gate inert)", async (ctx) => {
    const d = gate(ctx);
    await seedAdmin(d);
    expect(await isInvitePermitted(BOOTSTRAP_EMAIL)).toBe(false);
  });
});

describe("onSignIn (bootstrap branch)", () => {
  it("auto-grants admin + activates attorney profile for the founder", async (ctx) => {
    const d = gate(ctx);
    await seedFounderUser(d);

    await onSignIn({ userId: FOUNDER_ID, isNewUser: true });

    // Admin role granted (in addition to the default 'attorney').
    const roles = await d
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, FOUNDER_ID));
    const roleSet = new Set(roles.map((r) => r.role));
    expect(roleSet.has("admin")).toBe(true);
    expect(roleSet.has("attorney")).toBe(true);

    // Profile flipped to active so dashboard gate passes immediately.
    const [profile] = await d
      .select({ status: attorneyProfiles.status })
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, FOUNDER_ID));
    expect(profile?.status).toBe("active");

    // Audit log entry recorded with the system actor.
    const audits = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin.bootstrap"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe("system");
    expect(audits[0]?.actorUserId).toBeNull();
    expect(audits[0]?.targetId).toBe(FOUNDER_ID);
  });

  it("does NOT grant admin to a non-matching email", async (ctx) => {
    const d = gate(ctx);
    await seedStrangerUser(d);

    await onSignIn({ userId: STRANGER_ID, isNewUser: true });

    const roles = await d
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, STRANGER_ID));
    expect(roles.find((r) => r.role === "admin")).toBeUndefined();

    const [profile] = await d
      .select({ status: attorneyProfiles.status })
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, STRANGER_ID));
    expect(profile?.status).toBe("pending");

    const audits = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin.bootstrap"));
    expect(audits).toHaveLength(0);
  });

  it("does NOT re-fire when an admin already exists", async (ctx) => {
    const d = gate(ctx);
    // Seed a pre-existing admin so the bootstrap window is closed.
    await d.insert(users).values({
      id: PRE_EXISTING_ADMIN_ID,
      name: "Pre-Existing Admin",
      email: PRE_EXISTING_ADMIN_EMAIL,
    });
    await d
      .insert(userRoles)
      .values({ userId: PRE_EXISTING_ADMIN_ID, role: "admin" });

    await seedFounderUser(d);
    await onSignIn({ userId: FOUNDER_ID, isNewUser: true });

    // Founder did NOT get admin — the env-matched email lost the bootstrap
    // window because an admin already existed at sign-in time.
    const roles = await d
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, FOUNDER_ID));
    expect(roles.find((r) => r.role === "admin")).toBeUndefined();

    // Profile stayed at default 'pending' — they have to go through normal
    // approval flow.
    const [profile] = await d
      .select({ status: attorneyProfiles.status })
      .from(attorneyProfiles)
      .where(eq(attorneyProfiles.userId, FOUNDER_ID));
    expect(profile?.status).toBe("pending");

    const audits = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin.bootstrap"));
    expect(audits).toHaveLength(0);
  });

  it("is idempotent — second sign-in is a no-op (admin grant + activation already done)", async (ctx) => {
    const d = gate(ctx);
    await seedFounderUser(d);

    await onSignIn({ userId: FOUNDER_ID, isNewUser: true });
    await onSignIn({ userId: FOUNDER_ID, isNewUser: false });

    // Exactly one admin role row (PK on (user_id, role) prevents duplicates).
    const adminRoles = await d
      .select()
      .from(userRoles)
      .where(
        and(eq(userRoles.userId, FOUNDER_ID), eq(userRoles.role, "admin")),
      );
    expect(adminRoles).toHaveLength(1);

    // Exactly one audit row from the FIRST bootstrap; the second sign-in
    // saw an admin already (the founder themselves) and no-op'd.
    const audits = await d
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin.bootstrap"));
    expect(audits).toHaveLength(1);
  });
});

async function seedFounderUser(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: FOUNDER_ID,
    name: "Test Founder",
    email: BOOTSTRAP_EMAIL,
  });
}

async function seedStrangerUser(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: STRANGER_ID,
    name: "Test Stranger",
    email: NON_MATCH_EMAIL,
  });
}

async function seedAdmin(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: PRE_EXISTING_ADMIN_ID,
    name: "Pre-Existing Admin",
    email: PRE_EXISTING_ADMIN_EMAIL,
  });
  await d
    .insert(userRoles)
    .values({ userId: PRE_EXISTING_ADMIN_ID, role: "admin" });
}

async function teardown(d: TestDb): Promise<void> {
  await d
    .delete(auditLog)
    .where(eq(auditLog.action, "admin.bootstrap"));

  // Capture org ids before we cascade-delete the users that own them, so
  // we can drop the orphaned orgs after. `onSignIn()` provisions one org
  // per user; leaving them behind would let the slug-collision retry
  // path skew across runs.
  const orgIds = await d
    .select({ id: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(inArray(organizationMembers.userId, ALL_IDS));

  await d.delete(userRoles).where(inArray(userRoles.userId, ALL_IDS));
  await d
    .delete(attorneyProfiles)
    .where(inArray(attorneyProfiles.userId, ALL_IDS));
  // Cascades through organization_members + accounts + sessions etc.
  await d.delete(users).where(inArray(users.id, ALL_IDS));

  if (orgIds.length > 0) {
    await d
      .delete(organizations)
      .where(
        inArray(
          organizations.id,
          orgIds.map((r) => r.id),
        ),
      );
  }
}
