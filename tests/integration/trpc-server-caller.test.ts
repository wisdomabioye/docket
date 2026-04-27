// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  attorneyProfiles,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

// Mocks must precede importing `api` so `lib/trpc/server.ts` resolves them.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }));

// `next/headers` throws when called outside an RSC. Stub it.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

// Auth.js config — return a session our test controls.
vi.mock("@/server/auth/config", () => ({
  auth: sessionMock,
}));

import { api } from "@/lib/trpc/server";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * Proves the `createCallerFactory(appRouter)(createContext)` thunk
 * pattern in `lib/trpc/server.ts` actually works: a tRPC v11 caller
 * built from an async-context-fn invokes the context for each call.
 *
 * Hits the real DB through the server-side caller — same path RSC
 * pages take when they `import { api } from "@/lib/trpc/server"`.
 */

const USER = "50000000-0000-4000-8000-aaaa00000001";
const ORG = "50000000-0000-4000-8000-bbbb00000001";

let db: TestDb | null = null;
let rlsReady = false;

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
  await db.insert(users).values({
    id: USER,
    name: "Test Caller",
    email: "caller-test@docket.local",
  });
  await db.insert(userRoles).values({ userId: USER, role: "attorney" });
  await db
    .insert(attorneyProfiles)
    .values({ userId: USER, status: "active" });
  await db
    .insert(organizations)
    .values({ id: ORG, name: "Caller Org", slug: "caller-org-test" });
  await db.insert(organizationMembers).values({
    organizationId: ORG,
    userId: USER,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
  vi.restoreAllMocks();
});

describe("lib/trpc/server — async-fn caller", () => {
  it("invokes createContext per call and resolves auth", async (ctx) => {
    gate(ctx);
    sessionMock.mockResolvedValue({ user: { id: USER, email: null, name: null, image: null } });

    const result = await api.me.current();
    expect(result?.user.id).toBe(USER);
    expect(result?.user.email).toBe("caller-test@docket.local");
    expect(sessionMock).toHaveBeenCalled();
  });

  it("UNAUTHORIZED when session resolves to null", async (ctx) => {
    gate(ctx);
    sessionMock.mockResolvedValue(null);

    await expect(api.me.current()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("re-evaluates session on every call (no stale capture)", async (ctx) => {
    gate(ctx);
    sessionMock.mockResolvedValueOnce(null);
    await expect(api.me.current()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    sessionMock.mockResolvedValueOnce({
      user: { id: USER, email: null, name: null, image: null },
    });
    const ok = await api.me.current();
    expect(ok?.user.id).toBe(USER);
  });
});

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from organization_members where organization_id = ${ORG}`);
  await db.execute(sql`delete from organizations where id = ${ORG}`);
  await db.execute(sql`delete from attorney_profiles where user_id = ${USER}`);
  await db.execute(sql`delete from user_roles where user_id = ${USER}`);
  await db.execute(sql`delete from users where id = ${USER}`);
}
