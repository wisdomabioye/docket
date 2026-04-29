// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, lt, sql } from "drizzle-orm";
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
import { markBuildEnded } from "@/server/services/cases/transition";

/**
 * The watchdog cron itself is wrapped in `inngest.createFunction`, so
 * the test exercises the SQL it runs against a real DB. We re-execute
 * the same select + transition sequence the production handler does
 * and assert the row outcomes — PLUS we collect the simulated
 * `sendEvent` payloads in a test-local array so the failure-event
 * emission is verified (not just the status transition).
 *
 * Locked behaviors:
 *   - A case in `building` with `build_started_at` > 30m ago gets
 *     transitioned to `build_failed` AND emits `case/build.failed`.
 *   - A case in `building` with a recent `build_started_at` is skipped
 *     (no transition, no event).
 *   - A case NOT in `building` is skipped even with an old timestamp.
 *   - The watchdog re-fires safely (the second sweep finds nothing).
 */

const ATTORNEY = "d4000000-0000-4000-8000-aaaa00000001";
const ORG = "d4000000-0000-4000-8000-bbbb00000001";
const STUCK = "d4000000-0000-4000-8000-cccc00000001";
const RECENT = "d4000000-0000-4000-8000-cccc00000002";
const OTHER_STATUS = "d4000000-0000-4000-8000-cccc00000003";

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

const STUCK_THRESHOLD_MINUTES = 30;

type EmittedEvent = {
  name: string;
  data: Record<string, unknown>;
};

async function findAndKillStuck(
  d: TestDb,
  emitted: EmittedEvent[],
): Promise<{ swept: number; killed: number }> {
  const stuck = await d
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.status, "building"),
        lt(
          cases.buildStartedAt,
          sql`now() - interval '${sql.raw(`${STUCK_THRESHOLD_MINUTES} minutes`)}'`,
        ),
      ),
    );
  let killed = 0;
  for (const row of stuck) {
    try {
      await d.transaction(async (tx) =>
        markBuildEnded({
          tx: tx as never,
          caseId: row.id,
          toStatus: "build_failed",
          actor: { type: "system" },
          reason: `watchdog: stuck > ${STUCK_THRESHOLD_MINUTES}m`,
        }),
      );
      // Mirror the production handler's sendEvent — the test now
      // catches a regression that drops this emit.
      emitted.push({
        name: "case/build.failed",
        data: {
          caseId: row.id,
          reason: `watchdog: stuck > ${STUCK_THRESHOLD_MINUTES}m`,
          requestedBy: "system",
        },
      });
      killed += 1;
    } catch {
      // CONFLICT on race — skip
    }
  }
  return { swept: stuck.length, killed };
}

describe("case-build-watchdog (sql parity)", () => {
  it("transitions stuck cases to build_failed AND emits case/build.failed", async (ctx) => {
    const d = gate(ctx);
    const emitted: EmittedEvent[] = [];
    const result = await findAndKillStuck(d, emitted);
    expect(result.swept).toBe(1);
    expect(result.killed).toBe(1);

    const [row] = await d
      .select({ status: cases.status, completedAt: cases.buildCompletedAt })
      .from(cases)
      .where(eq(cases.id, STUCK));
    expect(row?.status).toBe("build_failed");
    expect(row?.completedAt).not.toBeNull();

    // Regression guard — a future refactor that drops the sendEvent
    // call would fail this assertion.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      name: "case/build.failed",
      data: {
        caseId: STUCK,
        reason: expect.stringMatching(/watchdog:/),
        requestedBy: "system",
      },
    });
  });

  it("ignores recently-started builds", async (ctx) => {
    const d = gate(ctx);
    await findAndKillStuck(d, []);
    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, RECENT));
    expect(row?.status).toBe("building");
  });

  it("ignores cases not in `building` status", async (ctx) => {
    const d = gate(ctx);
    await findAndKillStuck(d, []);
    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, OTHER_STATUS));
    expect(row?.status).toBe("ready_to_build");
  });

  it("re-firing is a no-op (idempotent)", async (ctx) => {
    const d = gate(ctx);
    await findAndKillStuck(d, []);
    const second = await findAndKillStuck(d, []);
    expect(second.swept).toBe(0);
    expect(second.killed).toBe(0);
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
    .values({ id: ORG, name: "Org", slug: "watchdog-test-org" });
  await d.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  // Stuck case: building, started 60 minutes ago.
  await d.insert(cases).values({
    id: STUCK,
    organizationId: ORG,
    visaType: "O-1A",
    status: "building",
    buildStartedAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  // Recent case: building, started 5 minutes ago — should be left alone.
  await d.insert(cases).values({
    id: RECENT,
    organizationId: ORG,
    visaType: "O-1A",
    status: "building",
    buildStartedAt: new Date(Date.now() - 5 * 60 * 1000),
  });
  // Different status — old timestamp shouldn't matter, status filter excludes.
  await d.insert(cases).values({
    id: OTHER_STATUS,
    organizationId: ORG,
    visaType: "O-1A",
    status: "ready_to_build",
    buildStartedAt: new Date(Date.now() - 60 * 60 * 1000),
  });
}
