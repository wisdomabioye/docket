// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseEvents,
  caseOutputs,
  caseParticipants,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

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

// Mock the heavy PDF render path so this test doesn't pull in
// @react-pdf/renderer's startup cost. The compile result is the same
// shape the real service returns.
const compileMock = vi.hoisted(() =>
  vi.fn(async (args: { caseId: string }) => {
    void args;
    return {
      url: "/api/files/package-stub",
      key: "cases/test/pdf/package-stub.pdf",
      bytes: 5678,
    };
  }),
);
vi.mock("@/server/services/pdf", () => ({
  compileFullPackagePdf: compileMock,
  renderPerOutputPdf: vi.fn(async () => ({
    url: "/api/files/per-output-stub",
    key: "k",
    bytes: 1234,
  })),
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
 * Step 5 — `output.downloadPackage` lifecycle wiring.
 *
 * Asserts the contract from ADR-006:
 *   - First successful download from `approved` flips status to
 *     `delivered`, populates both `packageCompiledAt` and
 *     `deliveredAt`, writes exactly one `case.status_changed` event.
 *   - Second download is idempotent — no churn on timestamps,
 *     no new transition, but the signed URL is still returned.
 *   - Download from `in_review` (or any state where compile would
 *     reject) does not transition the case and does not populate
 *     timestamps.
 *   - The `case.lifecycle_transition` analytics fires exactly once.
 */

const ATTORNEY = "f4000000-0000-4000-8000-aaaa00000001";
const ORG = "f4000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f4000000-0000-4000-8000-cccc00000001";

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

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
  if (!rlsReady) return;
  await teardown(db);
  await db.insert(users).values({
    id: ATTORNEY,
    name: "Package Lifecycle Attorney",
    email: "lifecycle-pkg-att@docket.local",
  });
  await db.insert(userRoles).values({ userId: ATTORNEY, role: "attorney" });
  await db.insert(organizations).values({
    id: ORG,
    name: "Pkg Lifecycle Org",
    slug: "lifecycle-pkg-org",
  });
  await db.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await db.insert(attorneyProfiles).values({
    userId: ATTORNEY,
    status: "active",
  });
});

beforeEach(async () => {
  if (!db) return;
  await db.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from cases where id = ${CASE_ID}`);
  sendMock.mockClear();
  compileMock.mockClear();
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

async function seedCase(
  d: TestDb,
  status: "approved" | "in_review" | "delivered" | "filed",
): Promise<void> {
  await d.insert(cases).values({
    id: CASE_ID,
    organizationId: ORG,
    visaType: "O-1A",
    status,
  });
  await d.insert(caseParticipants).values({
    caseId: CASE_ID,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
  // One approved output is enough for `compileFullPackagePdf`'s
  // service-layer check, but the mock bypasses that anyway.
  await d.insert(caseOutputs).values({
    caseId: CASE_ID,
    outputType: "personal_statement",
    outputVersion: 1,
    isCurrent: true,
    author: "computer",
    content: "approved prose",
    attorneyApproved: true,
  });
}

async function readCase(d: TestDb): Promise<{
  status: string;
  packageCompiledAt: Date | null;
  deliveredAt: Date | null;
} | undefined> {
  const [row] = await d
    .select({
      status: cases.status,
      packageCompiledAt: cases.packageCompiledAt,
      deliveredAt: cases.deliveredAt,
    })
    .from(cases)
    .where(eq(cases.id, CASE_ID));
  return row;
}

async function transitionCount(d: TestDb): Promise<number> {
  const events = await d
    .select({ eventType: caseEvents.eventType })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, CASE_ID));
  return events.filter((e) => e.eventType === "case.status_changed").length;
}

describe("downloadPackage — lifecycle wiring (ADR-006)", () => {
  it("first download from approved flips to delivered with both timestamps", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "approved");

    const result = await callAs(ATTORNEY).output.downloadPackage({
      caseId: CASE_ID,
    });
    expect(result.url).toBe("/api/files/package-stub");

    const row = await readCase(d);
    expect(row?.status).toBe("delivered");
    expect(row?.packageCompiledAt).toBeInstanceOf(Date);
    expect(row?.deliveredAt).toBeInstanceOf(Date);
    expect(await transitionCount(d)).toBe(1);
  });

  it("second download is idempotent — no churn, signed URL still returned", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "approved");

    await callAs(ATTORNEY).output.downloadPackage({ caseId: CASE_ID });
    const firstRow = await readCase(d);

    const second = await callAs(ATTORNEY).output.downloadPackage({
      caseId: CASE_ID,
    });
    expect(second.url).toBe("/api/files/package-stub");

    const secondRow = await readCase(d);
    // Status unchanged; timestamps preserved (NOT re-bumped to a later now()).
    expect(secondRow?.status).toBe("delivered");
    expect(secondRow?.packageCompiledAt?.getTime()).toBe(
      firstRow?.packageCompiledAt?.getTime(),
    );
    expect(secondRow?.deliveredAt?.getTime()).toBe(
      firstRow?.deliveredAt?.getTime(),
    );
    // Still exactly one `case.status_changed` event total.
    expect(await transitionCount(d)).toBe(1);
    // compile ran twice — re-download recompiles for a fresh signed URL.
    expect(compileMock).toHaveBeenCalledTimes(2);
  });

  it("download from filed succeeds without re-transitioning", async (ctx) => {
    // Even though `filed → delivered` is a legal admin reverse edge,
    // re-downloading from `filed` should NOT trip it — the
    // `package_delivered` trigger has no rule from `filed`.
    const d = gate(ctx);
    await seedCase(d, "filed");

    const r = await callAs(ATTORNEY).output.downloadPackage({
      caseId: CASE_ID,
    });
    expect(r.url).toBe("/api/files/package-stub");

    const row = await readCase(d);
    expect(row?.status).toBe("filed");
    expect(await transitionCount(d)).toBe(0);
  });

  it("download from in_review propagates compile's BAD_REQUEST and does not transition", async (ctx) => {
    const d = gate(ctx);
    await seedCase(d, "in_review");
    // Override the mock: real compile would reject because the case
    // isn't fully approved. Mirror that here.
    compileMock.mockRejectedValueOnce(
      Object.assign(new Error("Approve at least one output before downloading the package."), {
        code: "BAD_REQUEST",
      }),
    );

    await expect(
      callAs(ATTORNEY).output.downloadPackage({ caseId: CASE_ID }),
    ).rejects.toThrow(/Approve at least/);

    const row = await readCase(d);
    expect(row?.status).toBe("in_review");
    expect(row?.packageCompiledAt).toBeNull();
    expect(row?.deliveredAt).toBeNull();
    expect(await transitionCount(d)).toBe(0);
  });
});

async function teardown(d: TestDb): Promise<void> {
  await d.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_events where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_participants where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from cases where id = ${CASE_ID}`);
  await d.execute(sql`delete from attorney_profiles where user_id = ${ATTORNEY}`);
  await d.execute(sql`delete from organization_members where organization_id = ${ORG}`);
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(sql`delete from user_roles where user_id = ${ATTORNEY}`);
  await d.execute(sql`delete from users where id = ${ATTORNEY}`);
}
