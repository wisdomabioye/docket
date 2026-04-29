// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  attorneyProfiles,
  caseDocuments,
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

// Stub `inngest.send` so the test doesn't need an Inngest event key /
// network. The other inngest exports (Inngest class, helpers) pass
// through unchanged so the rest of the codebase compiles.
vi.mock("@/server/jobs/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/jobs/client")>(
    "@/server/jobs/client",
  );
  return {
    ...actual,
    inngest: {
      ...actual.inngest,
      send: sendMock,
    },
  };
});

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    limit: 10,
    remaining: 9,
    reset: 0,
  })),
);

vi.mock("@/server/services/ratelimit", () => ({
  rateLimit: rateLimitMock,
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
 * `case.requestBuild` and `case.readiness` (Phase 11) — covers the
 * gates: status, content, rate limit, attorney profile, RLS, atomic
 * transition, event emission. `inngest.send` and `rateLimit` mocked so
 * the test stays in-process; the rest is real DB.
 */

const ATTORNEY = "70a00000-0000-4000-8000-aaaa00000001";
const SUSPENDED = "70a00000-0000-4000-8000-aaaa00000002";
const STRANGER = "70a00000-0000-4000-8000-aaaa00000003";
const ORG = "70a00000-0000-4000-8000-bbbb00000001";
const CASE_READY = "70a00000-0000-4000-8000-cccc00000001";
const CASE_INTAKE = "70a00000-0000-4000-8000-cccc00000002";
const CASE_BUILDING = "70a00000-0000-4000-8000-cccc00000003";
const CASE_NO_NAME = "70a00000-0000-4000-8000-cccc00000004";
const CASE_NO_DOCS = "70a00000-0000-4000-8000-cccc00000005";
const CASE_PENDING_EXTRACTION = "70a00000-0000-4000-8000-cccc00000006";

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
  await seed(db);
});

beforeEach(() => {
  sendMock.mockClear();
  rateLimitMock.mockClear();
  rateLimitMock.mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: 0,
  });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("case.readiness", () => {
  it("returns ok=true when status + content gates pass", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.readiness({ caseId: CASE_READY });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ready_to_build");
    expect(r.statusOk).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("returns ok=false with reason when beneficiary fullName is missing", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.readiness({ caseId: CASE_NO_NAME });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/full name/i)]),
    );
  });

  it("returns ok=false when no document has extracted text", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.readiness({ caseId: CASE_NO_DOCS });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/upload at least one/i)]),
    );
  });

  it("flags pending extractions", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.readiness({
      caseId: CASE_PENDING_EXTRACTION,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/being processed/i)]),
    );
  });

  it("status=intake fails the status gate even if content is ok", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.readiness({ caseId: CASE_INTAKE });
    expect(r.statusOk).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("NOT_FOUND for cases the caller can't see (RLS)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(STRANGER).case.readiness({ caseId: CASE_READY }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("case.requestBuild", () => {
  it("happy path: transitions to building + stamps build_started_at + emits inngest event", async (ctx) => {
    const d = gate(ctx);
    const r = await callAs(ATTORNEY).case.requestBuild({ caseId: CASE_READY });
    expect(r.ok).toBe(true);
    expect(r.eventId).toBe("evt-test-id");

    const [row] = await d
      .select({
        status: cases.status,
        buildStartedAt: cases.buildStartedAt,
        buildCompletedAt: cases.buildCompletedAt,
      })
      .from(cases)
      .where(eq(cases.id, CASE_READY));
    expect(row?.status).toBe("building");
    // `build_started_at` MUST be set so the watchdog can rescue the case
    // if the Inngest pipeline never picks it up — otherwise the
    // watchdog's `lt(buildStartedAt, now() - 30m)` is FALSE for NULL.
    expect(row?.buildStartedAt).not.toBeNull();
    expect(row?.buildCompletedAt).toBeNull();

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      name: "case/build.requested",
      data: { caseId: CASE_READY, requestedBy: ATTORNEY },
    });

    // Reset for subsequent tests using CASE_READY.
    await d
      .update(cases)
      .set({
        status: "ready_to_build",
        buildStartedAt: null,
        buildCompletedAt: null,
      })
      .where(eq(cases.id, CASE_READY));
  });

  it("when inngest.send fails, case is left in `building` with build_started_at stamped (watchdog-recoverable)", async (ctx) => {
    const d = gate(ctx);
    sendMock.mockRejectedValueOnce(new Error("inngest network error"));
    await expect(
      callAs(ATTORNEY).case.requestBuild({ caseId: CASE_READY }),
    ).rejects.toThrow();

    const [row] = await d
      .select({
        status: cases.status,
        buildStartedAt: cases.buildStartedAt,
      })
      .from(cases)
      .where(eq(cases.id, CASE_READY));
    expect(row?.status).toBe("building");
    // The bug this test guards against: if `build_started_at` is NULL
    // here, the watchdog can never sweep the case → stuck forever.
    expect(row?.buildStartedAt).not.toBeNull();

    // Reset.
    await d
      .update(cases)
      .set({
        status: "ready_to_build",
        buildStartedAt: null,
        buildCompletedAt: null,
      })
      .where(eq(cases.id, CASE_READY));
  });

  it("CONFLICT when status=intake (not BUILDABLE_STATUSES)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).case.requestBuild({ caseId: CASE_INTAKE }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("CONFLICT when status=building (build already running)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).case.requestBuild({ caseId: CASE_BUILDING }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("BAD_REQUEST when content gate fails (no fullName)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).case.requestBuild({ caseId: CASE_NO_NAME }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("TOO_MANY_REQUESTS when rate-limited", async (ctx) => {
    gate(ctx);
    rateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    await expect(
      callAs(ATTORNEY).case.requestBuild({ caseId: CASE_READY }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("FORBIDDEN when attorney profile is suspended", async (ctx) => {
    gate(ctx);
    // Suspended attorney is in a different org with their own case, so
    // they can see at least one case via RLS — the FORBIDDEN comes from
    // attorneyProcedure middleware, not from the case lookup.
    await expect(
      callAs(SUSPENDED).case.requestBuild({ caseId: CASE_READY }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("UNAUTHORIZED when not signed in", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(null).case.requestBuild({ caseId: CASE_READY }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("NOT_FOUND for cases the caller can't see (RLS)", async (ctx) => {
    gate(ctx);
    // STRANGER is an active attorney in their own org but has no
    // participant row on CASE_READY — RLS hides the row.
    await expect(
      callAs(STRANGER).case.requestBuild({ caseId: CASE_READY }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ATTORNEY, name: "Attorney", email: "rb-att@docket.local" },
    { id: SUSPENDED, name: "Suspended", email: "rb-sus@docket.local" },
    { id: STRANGER, name: "Stranger", email: "rb-str@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: SUSPENDED, role: "attorney" },
    { userId: STRANGER, role: "attorney" },
  ]);
  await d.insert(organizations).values({
    id: ORG,
    name: "Org",
    slug: "request-build-test-org",
  });
  await d.insert(organizationMembers).values([
    {
      organizationId: ORG,
      userId: ATTORNEY,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: ORG,
      userId: SUSPENDED,
      role: "member",
      status: "active",
      acceptedAt: new Date(),
    },
  ]);
  await d.insert(attorneyProfiles).values([
    { userId: ATTORNEY, status: "active" },
    { userId: SUSPENDED, status: "suspended" },
    { userId: STRANGER, status: "active" }, // active but not in ORG
  ]);

  // Six cases scoped to ORG; ATTORNEY is a participant on each so RLS
  // lets them through. STRANGER has no participation → can't see.
  const baseCase = (id: string, extra: Record<string, unknown>) => ({
    id,
    organizationId: ORG,
    visaType: "O-1A" as const,
    beneficiaryData: { fullName: "Test Beneficiary 001" },
    ...extra,
  });
  await d.insert(cases).values([
    baseCase(CASE_READY, { status: "ready_to_build" }),
    baseCase(CASE_INTAKE, { status: "intake" }),
    baseCase(CASE_BUILDING, { status: "building" }),
    baseCase(CASE_NO_NAME, {
      status: "ready_to_build",
      beneficiaryData: { occupation: "Researcher" }, // missing fullName
    }),
    baseCase(CASE_NO_DOCS, { status: "ready_to_build" }),
    baseCase(CASE_PENDING_EXTRACTION, { status: "ready_to_build" }),
  ]);

  await d.insert(caseParticipants).values(
    [
      CASE_READY,
      CASE_INTAKE,
      CASE_BUILDING,
      CASE_NO_NAME,
      CASE_NO_DOCS,
      CASE_PENDING_EXTRACTION,
    ].map((cid) => ({
      caseId: cid,
      userId: ATTORNEY,
      role: "attorney" as const,
      isPrimary: true,
    })),
  );

  // Documents: every case except CASE_NO_DOCS has a completed-extraction
  // doc with text; CASE_PENDING_EXTRACTION has one pending doc.
  const docsWithText: Array<{ caseId: string; suffix: string }> = [
    { caseId: CASE_READY, suffix: "01" },
    { caseId: CASE_INTAKE, suffix: "02" },
    { caseId: CASE_BUILDING, suffix: "03" },
    { caseId: CASE_NO_NAME, suffix: "04" },
  ];
  await d.insert(caseDocuments).values(
    docsWithText.map(({ caseId, suffix }) => ({
      caseId,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume" as const,
      originalFilename: "cv.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000n,
      sha256: `a${suffix}`.padEnd(64, "0"),
      storagePath: `/test/${caseId}.pdf`,
      extractionStatus: "completed" as const,
      extractedText: "extracted prose",
    })),
  );
  await d.insert(caseDocuments).values({
    caseId: CASE_PENDING_EXTRACTION,
    uploadedBy: ATTORNEY,
    documentType: "cv_resume",
    originalFilename: "pending.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1000n,
    sha256: "b".repeat(64),
    storagePath: "/test/pending.pdf",
    extractionStatus: "pending",
    extractedText: null,
  });
}

async function teardown(d: TestDb): Promise<void> {
  await d.execute(
    /* sql */ `delete from case_documents where case_id in (
      '${CASE_READY}', '${CASE_INTAKE}', '${CASE_BUILDING}', '${CASE_NO_NAME}', '${CASE_NO_DOCS}', '${CASE_PENDING_EXTRACTION}'
    )` as never,
  );
  await d.execute(
    /* sql */ `delete from cases where organization_id = '${ORG}'` as never,
  );
  await d.execute(
    /* sql */ `delete from attorney_profiles where user_id in ('${ATTORNEY}', '${SUSPENDED}', '${STRANGER}')` as never,
  );
  await d.execute(
    /* sql */ `delete from organization_members where organization_id = '${ORG}'` as never,
  );
  await d.execute(
    /* sql */ `delete from organizations where id = '${ORG}'` as never,
  );
  await d.execute(
    /* sql */ `delete from user_roles where user_id in ('${ATTORNEY}', '${SUSPENDED}', '${STRANGER}')` as never,
  );
  await d.execute(
    /* sql */ `delete from users where id in ('${ATTORNEY}', '${SUSPENDED}', '${STRANGER}')` as never,
  );
}
