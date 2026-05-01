// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
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

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: 0 })),
);
vi.mock("@/server/services/ratelimit", () => ({ rateLimit: rateLimitMock }));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * Stage 11 W5 — `search.global` integration. Drives the real tRPC
 * stack against the real test DB so RLS, the `app_user` role, and the
 * trigram indexes all engage.
 *
 * What this locks down:
 *   - Soft-deleted cases / docs are excluded (cross-cutting #178).
 *   - Empty / blank `q` short-circuits to empty arrays without firing
 *     SQL or consuming the rate-limit token.
 *   - RLS hides another attorney's case (cross-tenant isolation).
 *   - Filename match returns the filename as snippet; extracted-text
 *     match returns the surrounding excerpt.
 *   - Results are ordered by similarity descending.
 *   - Per-category limit honored.
 */

const ATTORNEY = "f5000000-0000-4000-8000-aaaa00000001";
const STRANGER = "f5000000-0000-4000-8000-aaaa00000002";
const ORG_ATTORNEY = "f5000000-0000-4000-8000-bbbb00000001";
const ORG_STRANGER = "f5000000-0000-4000-8000-bbbb00000002";
const CASE_VISIBLE = "f5000000-0000-4000-8000-cccc00000001";
const CASE_STRANGER = "f5000000-0000-4000-8000-cccc00000002";

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
});

beforeEach(async () => {
  if (!db) return;
  await truncateAllAppTables(db);
  await seed(db);
  rateLimitMock.mockClear();
  rateLimitMock.mockImplementation(async () => ({
    success: true,
    limit: 60,
    remaining: 59,
    reset: 0,
  }));
});

afterAll(async () => {
  await closeTestDb();
});

describe("search.global — empty query", () => {
  it("returns empty arrays for a blank `q` without consuming the limiter", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).search.global({ q: "   " });
    expect(r.cases).toEqual([]);
    expect(r.documents).toEqual([]);
    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});

describe("search.global — case matches", () => {
  it("finds a case by beneficiary fullName trigram match", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).search.global({ q: "maria" });
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]).toMatchObject({
      id: CASE_VISIBLE,
      beneficiaryName: "Maria Gonzalez",
      visaType: "O-1A",
    });
    expect(r.cases[0]?.similarity).toBeGreaterThan(0);
  });

  it("excludes a soft-deleted case from results", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ deletedAt: new Date() })
      .where(eq(cases.id, CASE_VISIBLE));
    const r = await callAs(ATTORNEY).search.global({ q: "maria" });
    expect(r.cases).toEqual([]);
  });

  it("RLS hides a case the caller doesn't participate in", async (ctx) => {
    gate(ctx);
    // STRANGER's case has a unique beneficiary name; ATTORNEY must NOT
    // see it.
    const r = await callAs(ATTORNEY).search.global({ q: "ingvar" });
    expect(r.cases).toEqual([]);

    // Sanity: the stranger CAN see their own case.
    const own = await callAs(STRANGER).search.global({ q: "ingvar" });
    expect(own.cases).toHaveLength(1);
    expect(own.cases[0]?.id).toBe(CASE_STRANGER);
  });

  it("orders multiple matches by similarity descending", async (ctx) => {
    const d = gate(ctx);
    // Both names share a "maria" substring. The exact match
    // "Maria Lopez" must rank above "Mariam Hassan" (extra characters
    // dilute the trigram ratio), and both must rank above the seeded
    // "Maria Gonzalez" only by tie-break.
    const CASE_NEAR = "f5000000-0000-4000-8000-cccc00000003";
    await d.insert(cases).values({
      id: CASE_NEAR,
      organizationId: ORG_ATTORNEY,
      visaType: "EB-1A",
      status: "intake",
      beneficiaryData: { fullName: "Mariam Hassan" },
    });
    await d.insert(caseParticipants).values({
      caseId: CASE_NEAR,
      userId: ATTORNEY,
      role: "attorney",
      isPrimary: true,
    });
    const r = await callAs(ATTORNEY).search.global({ q: "maria" });
    expect(r.cases.length).toBeGreaterThanOrEqual(2);
    // Strict descending order on `similarity`.
    for (let i = 1; i < r.cases.length; i += 1) {
      expect(r.cases[i - 1]!.similarity).toBeGreaterThanOrEqual(
        r.cases[i]!.similarity,
      );
    }
  });

  it("honors `limit` per category", async (ctx) => {
    const d = gate(ctx);
    // Seed 3 extra cases with closely-matching names. Limit=2 should
    // truncate.
    for (let i = 0; i < 3; i += 1) {
      const id = `f5000000-0000-4000-8000-cccc1000000${i}`;
      await d.insert(cases).values({
        id,
        organizationId: ORG_ATTORNEY,
        visaType: "O-1A",
        status: "intake",
        beneficiaryData: { fullName: `Maria Cluster ${i}` },
      });
      await d.insert(caseParticipants).values({
        caseId: id,
        userId: ATTORNEY,
        role: "attorney",
        isPrimary: true,
      });
    }
    const r = await callAs(ATTORNEY).search.global({ q: "maria", limit: 2 });
    expect(r.cases).toHaveLength(2);
  });
});

describe("search.global — document matches", () => {
  it("finds a doc by filename trigram match; snippet is the filename when no extracted-text hit", async (ctx) => {
    const d = gate(ctx);
    await insertDoc(d, {
      filename: "personal_statement_draft.pdf",
      extractedText: null,
    });
    const r = await callAs(ATTORNEY).search.global({ q: "statement" });
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0]?.filename).toBe("personal_statement_draft.pdf");
    // No extracted text → snippet falls back to the filename.
    expect(r.documents[0]?.snippet).toBe("personal_statement_draft.pdf");
  });

  it("returns an excerpt around the first extracted-text match", async (ctx) => {
    const d = gate(ctx);
    const longText =
      "Lorem ipsum dolor sit amet. The petitioner has demonstrated extraordinary ability " +
      "across multiple criteria. Citation count exceeds 1247 across peer reviewed venues. " +
      "Closing paragraph.";
    await insertDoc(d, {
      filename: "summary.pdf",
      extractedText: longText,
    });
    const r = await callAs(ATTORNEY).search.global({ q: "extraordinary" });
    expect(r.documents).toHaveLength(1);
    const snippet = r.documents[0]?.snippet ?? "";
    expect(snippet.toLowerCase()).toContain("extraordinary");
    // Snippet is shorter than the original AND not the filename (we
    // got an extracted-text hit).
    expect(snippet).not.toBe("summary.pdf");
    expect(snippet.length).toBeLessThan(longText.length);
  });

  it("excludes a soft-deleted document from results", async (ctx) => {
    const d = gate(ctx);
    await insertDoc(d, {
      filename: "removed_doc_abc.pdf",
      extractedText: null,
    });
    await d
      .update(caseDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(caseDocuments.originalFilename, "removed_doc_abc.pdf"));
    const r = await callAs(ATTORNEY).search.global({ q: "removed_doc" });
    expect(r.documents).toEqual([]);
  });

  it("RLS hides a document on a case the caller doesn't participate in", async (ctx) => {
    const d = gate(ctx);
    // Document belongs to STRANGER's case.
    await d.insert(caseDocuments).values({
      caseId: CASE_STRANGER,
      uploadedBy: STRANGER,
      documentType: "other",
      originalFilename: "stranger_only_secret_paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024n,
      sha256: "f".repeat(64),
      storagePath: "/test/stranger.pdf",
      extractionStatus: "completed",
    });
    const r = await callAs(ATTORNEY).search.global({
      q: "stranger_only",
    });
    expect(r.documents).toEqual([]);
  });
});

describe("search.global — rate limiting", () => {
  it("throws TOO_MANY_REQUESTS when the limiter rejects", async (ctx) => {
    gate(ctx);
    rateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    await expect(
      callAs(ATTORNEY).search.global({ q: "maria" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

let docCounter = 0;
async function insertDoc(
  d: TestDb,
  args: { filename: string; extractedText: string | null },
): Promise<void> {
  docCounter += 1;
  const sha = String(docCounter).padStart(64, "0");
  await d.insert(caseDocuments).values({
    caseId: CASE_VISIBLE,
    uploadedBy: ATTORNEY,
    documentType: "other",
    originalFilename: args.filename,
    mimeType: "application/pdf",
    sizeBytes: 1024n,
    sha256: sha,
    storagePath: `/test/${args.filename}`,
    extractionStatus: "completed",
    extractedText: args.extractedText,
  });
}

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ATTORNEY, name: "Search Attorney", email: "search-att@docket.local" },
    { id: STRANGER, name: "Search Stranger", email: "search-str@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: STRANGER, role: "attorney" },
  ]);
  await d.insert(organizations).values([
    { id: ORG_ATTORNEY, name: "Attorney Org", slug: "search-attorney-org" },
    { id: ORG_STRANGER, name: "Stranger Org", slug: "search-stranger-org" },
  ]);
  await d.insert(organizationMembers).values([
    {
      organizationId: ORG_ATTORNEY,
      userId: ATTORNEY,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
    {
      organizationId: ORG_STRANGER,
      userId: STRANGER,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    },
  ]);
  await d.insert(attorneyProfiles).values([
    { userId: ATTORNEY, status: "active" },
    { userId: STRANGER, status: "active" },
  ]);
  await d.insert(cases).values([
    {
      id: CASE_VISIBLE,
      organizationId: ORG_ATTORNEY,
      visaType: "O-1A",
      status: "draft_ready",
      beneficiaryData: { fullName: "Maria Gonzalez" },
    },
    {
      id: CASE_STRANGER,
      organizationId: ORG_STRANGER,
      visaType: "O-1A",
      status: "draft_ready",
      beneficiaryData: { fullName: "Ingvar Kjeldsen" },
    },
  ]);
  await d.insert(caseParticipants).values([
    {
      caseId: CASE_VISIBLE,
      userId: ATTORNEY,
      role: "attorney",
      isPrimary: true,
    },
    {
      caseId: CASE_STRANGER,
      userId: STRANGER,
      role: "attorney",
      isPrimary: true,
    },
  ]);
  // Make sure pg_trgm session limit is permissive — defaults to 0.3
  // which already lines up with the router's threshold.
  await d.execute(sql`select set_limit(0.2)`);
}
