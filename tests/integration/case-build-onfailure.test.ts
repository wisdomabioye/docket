// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  cases,
  organizationMembers,
  organizations,
  users,
} from "@/server/db/schema";

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
import { transitionCase } from "@/server/services/cases/transition";

/**
 * `case-build` onFailure handler. The handler is wrapped inside the
 * Inngest `createFunction` config and isn't directly exportable, so we
 * re-execute its SQL/business logic against a real DB and assert the
 * row outcomes — same approach the `computer-health.test.ts` and
 * `case-build-watchdog.test.ts` use for cron/onFailure handlers.
 *
 * Locked behaviors:
 *   - Status=building → transitions to build_failed, stamps completedAt,
 *     reports `transitioned=true` (caller emits the event).
 *   - Status=draft_ready (build finalized before crash) → no-op.
 *   - Status=build_failed (already failed) → no-op (idempotent).
 *   - Missing case → no-op (silent — case may have been archived).
 */

const ATTORNEY = "d5000000-0000-4000-8000-aaaa00000001";
const ORG = "d5000000-0000-4000-8000-bbbb00000001";
const CASE_BUILDING = "d5000000-0000-4000-8000-cccc00000001";
const CASE_DRAFT_READY = "d5000000-0000-4000-8000-cccc00000002";
const CASE_BUILD_FAILED = "d5000000-0000-4000-8000-cccc00000003";

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
  await seed(db);
});

afterAll(async () => {
  await closeTestDb();
});

/** Mirrors the body of `caseBuild`'s `onFailure` step.run callback —
 *  must stay in sync with `server/jobs/case-build.ts`. */
async function runOnFailureCleanup(
  d: TestDb,
  caseId: string,
  reason: string,
): Promise<boolean> {
  return await d.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, caseId))
      .limit(1)
      .for("update");
    if (row?.status !== "building") return false;
    await transitionCase({
      tx: tx as never,
      caseId,
      toStatus: "build_failed",
      actor: { type: "system" },
      reason,
    });
    await tx
      .update(cases)
      .set({ buildCompletedAt: sql`now()` })
      .where(eq(cases.id, caseId));
    return true;
  });
}

describe("case-build onFailure cleanup", () => {
  it("status=building → transitions to build_failed and stamps completedAt", async (ctx) => {
    const d = gate(ctx);
    const transitioned = await runOnFailureCleanup(
      d,
      CASE_BUILDING,
      "step crashed mid-run",
    );
    expect(transitioned).toBe(true);
    const [row] = await d
      .select({
        status: cases.status,
        completedAt: cases.buildCompletedAt,
      })
      .from(cases)
      .where(eq(cases.id, CASE_BUILDING));
    expect(row?.status).toBe("build_failed");
    expect(row?.completedAt).not.toBeNull();
  });

  it("status=draft_ready → no-op (success already finalized)", async (ctx) => {
    const d = gate(ctx);
    const transitioned = await runOnFailureCleanup(
      d,
      CASE_DRAFT_READY,
      "emit-completed step crashed",
    );
    expect(transitioned).toBe(false);
    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_DRAFT_READY));
    // Status is preserved — onFailure must not clobber a successful
    // finalize. The event emission would have been the only thing to
    // miss; that's acceptable degradation vs. corrupting the row.
    expect(row?.status).toBe("draft_ready");
  });

  it("status=build_failed → no-op (idempotent on repeat firing)", async (ctx) => {
    const d = gate(ctx);
    const transitioned = await runOnFailureCleanup(
      d,
      CASE_BUILD_FAILED,
      "double-fire safety",
    );
    expect(transitioned).toBe(false);
  });

  it("missing case → no-op (silent — case archived between fail and onFailure)", async (ctx) => {
    const d = gate(ctx);
    const transitioned = await runOnFailureCleanup(
      d,
      "00000000-0000-4000-8000-000000000000",
      "missing case",
    );
    expect(transitioned).toBe(false);
  });
});

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Attorney",
    email: "att@docket.local",
  });
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Org", slug: "onfailure-test-org" });
  await d.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await d.insert(cases).values([
    {
      id: CASE_BUILDING,
      organizationId: ORG,
      visaType: "O-1A",
      status: "building",
      buildStartedAt: new Date(),
    },
    {
      id: CASE_DRAFT_READY,
      organizationId: ORG,
      visaType: "O-1A",
      status: "draft_ready",
      buildStartedAt: new Date(Date.now() - 10 * 60 * 1000),
      buildCompletedAt: new Date(),
    },
    {
      id: CASE_BUILD_FAILED,
      organizationId: ORG,
      visaType: "O-1A",
      status: "build_failed",
      buildStartedAt: new Date(Date.now() - 30 * 60 * 1000),
      buildCompletedAt: new Date(Date.now() - 5 * 60 * 1000),
    },
  ]);
}
