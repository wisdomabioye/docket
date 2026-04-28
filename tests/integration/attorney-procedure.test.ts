// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  attorneyProfiles,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import {
  attorneyProcedure,
  createCallerFactory,
  router,
} from "@/server/api/trpc";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * `attorneyProcedure` = `protectedProcedure` + `requireActiveAttorney`.
 * Used by mutating attorney-only procedures (Stage 07 will wire
 * `case.requestBuild` first). Tests verify all three rejection paths
 * land on FORBIDDEN and the active path resolves.
 */

// Tiny ad-hoc router that exposes an attorney-only echo procedure for
// the test caller. Lives only here so we don't have to wire a real
// procedure into appRouter just to test the middleware.
const testRouter = router({
  echo: attorneyProcedure
    .input(z.object({ msg: z.string() }))
    .mutation(({ input }) => ({ ok: true as const, msg: input.msg })),
});

const ACTIVE = "c0000000-0000-4000-8000-aaaa00000001";
const PENDING = "c0000000-0000-4000-8000-bbbb00000001";
const SUSPENDED = "c0000000-0000-4000-8000-cccc00000001";
const NO_PROFILE = "c0000000-0000-4000-8000-dddd00000001";
const ORG = "c0000000-0000-4000-8000-eeee00000001";
const ALL_USER_IDS = [ACTIVE, PENDING, SUSPENDED, NO_PROFILE];

let db: TestDb | null = null;
let rlsReady = false;

const callerFactory = createCallerFactory(testRouter);
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
});

beforeEach(async () => {
  if (!db) return;
  await truncateAllAppTables(db);
  await seedFixtures(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("attorneyProcedure", () => {
  it("resolves for active attorney profile", async (ctx) => {
    gate(ctx);
    const out = await callAs(ACTIVE).echo({ msg: "hello" });
    expect(out).toEqual({ ok: true, msg: "hello" });
  });

  it("rejects pending attorney profile with FORBIDDEN", async (ctx) => {
    gate(ctx);
    await expect(callAs(PENDING).echo({ msg: "hi" })).rejects.toThrow(
      /active attorney profile required/i,
    );
  });

  it("rejects suspended attorney profile with FORBIDDEN", async (ctx) => {
    gate(ctx);
    await expect(callAs(SUSPENDED).echo({ msg: "hi" })).rejects.toThrow(
      /active attorney profile required/i,
    );
  });

  it("rejects user with no attorney profile with FORBIDDEN", async (ctx) => {
    gate(ctx);
    await expect(callAs(NO_PROFILE).echo({ msg: "hi" })).rejects.toThrow(
      /active attorney profile required/i,
    );
  });

  it("rejects unauthenticated caller with UNAUTHORIZED (protected layer)", async (ctx) => {
    gate(ctx);
    await expect(callAs(null).echo({ msg: "hi" })).rejects.toThrow(
      /sign-in required/i,
    );
  });
});

async function seedFixtures(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ACTIVE, name: "Active Attorney", email: "active-att@docket.local" },
    { id: PENDING, name: "Pending Attorney", email: "pending-att@docket.local" },
    {
      id: SUSPENDED,
      name: "Suspended Attorney",
      email: "suspended-att@docket.local",
    },
    {
      id: NO_PROFILE,
      name: "Profileless User",
      email: "no-profile@docket.local",
    },
  ]);
  // user_roles + org membership aren't strictly required by
  // attorneyProcedure (it only reads attorneyProfiles.status), but
  // RLS-engaged reads pass cleanly with proper attribution.
  await d.insert(userRoles).values([
    { userId: ACTIVE, role: "attorney" },
    { userId: PENDING, role: "attorney" },
    { userId: SUSPENDED, role: "attorney" },
    { userId: NO_PROFILE, role: "attorney" },
  ]);
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Test Org", slug: "attorney-procedure-test-org" });
  await d.insert(organizationMembers).values([
    {
      organizationId: ORG,
      userId: ACTIVE,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: ORG,
      userId: PENDING,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: ORG,
      userId: SUSPENDED,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: ORG,
      userId: NO_PROFILE,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
  ]);
  await d.insert(attorneyProfiles).values([
    { userId: ACTIVE, status: "active" },
    { userId: PENDING, status: "pending" },
    { userId: SUSPENDED, status: "suspended" },
    // NO_PROFILE deliberately has no row.
  ]);
}

// Lint guard
void ALL_USER_IDS;
