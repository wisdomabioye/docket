// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  caseDocuments,
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
import {
  meetsBuildRequirements,
  reconcileCaseAfterExtraction,
} from "@/server/services/cases/readiness";
import { caseEvents } from "@/server/db/schema";

/**
 * Direct unit test for `meetsBuildRequirements` against a real DB.
 * `case-request-build.test.ts` covers the same logic transitively through
 * the tRPC procedure, but the direct test catches:
 *   - Multiple-reason aggregation (the procedure stops at first failure)
 *   - Whitespace-only `fullName` is treated as missing
 *   - The `status` field is returned alongside readiness
 *   - NOT_FOUND is thrown (not a `{ok:false, reasons: ["case missing"]}`)
 *   - `processing` extraction status is treated the same as `pending`
 *   - Soft-deleted documents don't count toward extraction tally
 */

const ATTORNEY = "d7000000-0000-4000-8000-aaaa00000001";
const ORG = "d7000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d7000000-0000-4000-8000-cccc00000001";

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
  await seedBase(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("meetsBuildRequirements", () => {
  it("returns ok=true with the case status when all gates pass", async (ctx) => {
    const d = gate(ctx);
    await d.update(cases).set({ status: "ready_to_build" }).where(eq(cases.id, CASE_ID));
    await insertCompletedDoc(d, "a");
    const r = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ready_to_build");
    expect(r.reasons).toEqual([]);
  });

  it("aggregates multiple reasons (no fullName + no docs) — caller sees the full picture", async (ctx) => {
    const d = gate(ctx);
    await d.update(cases).set({ beneficiaryData: {} }).where(eq(cases.id, CASE_ID));
    const r = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/full name/i),
        expect.stringMatching(/upload at least one/i),
      ]),
    );
  });

  it("treats whitespace-only fullName as missing (no leading-space bypass)", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ beneficiaryData: { fullName: "   \t  " } })
      .where(eq(cases.id, CASE_ID));
    await insertCompletedDoc(d, "b");
    const r = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/full name/i)]),
    );
  });

  it("treats `processing` extraction the same as `pending`", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseDocuments).values({
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume",
      originalFilename: "p.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1n,
      sha256: "p".repeat(64),
      storagePath: "/t/p.pdf",
      extractionStatus: "processing",
      extractedText: null,
    });
    const r = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/being processed/i)]),
    );
  });

  it("singular vs plural in the pending-extraction reason", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseDocuments).values({
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume",
      originalFilename: "1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1n,
      sha256: "1".repeat(64),
      storagePath: "/t/1.pdf",
      extractionStatus: "pending",
      extractedText: null,
    });
    const r1 = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r1.reasons.find((s) => /1 document is /i.test(s))).toBeDefined();

    await d.insert(caseDocuments).values({
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume",
      originalFilename: "2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1n,
      sha256: "2".repeat(64),
      storagePath: "/t/2.pdf",
      extractionStatus: "processing",
      extractedText: null,
    });
    const r2 = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r2.reasons.find((s) => /2 documents are /i.test(s))).toBeDefined();
  });

  it("ignores soft-deleted documents in the tally", async (ctx) => {
    const d = gate(ctx);
    // One completed doc but soft-deleted → should NOT count.
    await d.insert(caseDocuments).values({
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume",
      originalFilename: "deleted.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1n,
      sha256: "d".repeat(64),
      storagePath: "/t/d.pdf",
      extractionStatus: "completed",
      extractedText: "had text",
      deletedAt: new Date(),
    });
    const r = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r.ok).toBe(false);
    // The "no docs" reason should still fire.
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/upload at least one/i)]),
    );
  });

  it("treats empty extracted_text as not-extracted (failed OCR)", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseDocuments).values({
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume",
      originalFilename: "blank.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1n,
      sha256: "e".repeat(64),
      storagePath: "/t/e.pdf",
      extractionStatus: "completed",
      extractedText: "", // OCR finished but extracted nothing
    });
    const r = await meetsBuildRequirements({ db: d as never, caseId: CASE_ID });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/upload at least one/i)]),
    );
  });

  it("throws NOT_FOUND when case is missing (no content-leak via reasons)", async (ctx) => {
    const d = gate(ctx);
    await expect(
      meetsBuildRequirements({
        db: d as never,
        caseId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when case is soft-deleted", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ deletedAt: new Date() })
      .where(eq(cases.id, CASE_ID));
    await expect(
      meetsBuildRequirements({ db: d as never, caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reconcileCaseAfterExtraction", () => {
  it("documents_pending → extracting when at least one doc is processing", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ status: "documents_pending" })
      .where(eq(cases.id, CASE_ID));
    await insertDocWithStatus(d, "a", "processing");

    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });

    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("extracting");
  });

  it("extracting → ready_to_build once every doc is completed-with-text", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ status: "extracting" })
      .where(eq(cases.id, CASE_ID));
    await insertCompletedDoc(d, "a");
    await insertCompletedDoc(d, "b");

    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });

    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("ready_to_build");

    // status_changed event written so the activity feed sees the flip.
    const events = await d
      .select({ eventType: caseEvents.eventType })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, CASE_ID));
    expect(events.some((e) => e.eventType === "case.status_changed")).toBe(true);
  });

  it("extracting → build_failed when every extraction failed (zero text)", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ status: "extracting" })
      .where(eq(cases.id, CASE_ID));
    await insertDocWithStatus(d, "a", "failed");

    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });

    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("build_failed");
  });

  it("does not promote past extracting while pending docs remain", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ status: "extracting" })
      .where(eq(cases.id, CASE_ID));
    await insertCompletedDoc(d, "a");
    await insertDocWithStatus(d, "b", "processing");

    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });

    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("extracting");
  });

  it("leaves later lifecycle statuses alone (no auto-revert)", async (ctx) => {
    const d = gate(ctx);
    // building / draft_ready / approved etc. are not driven by
    // extraction; reconcile must not flip them backward.
    await d
      .update(cases)
      .set({ status: "draft_ready" })
      .where(eq(cases.id, CASE_ID));
    await insertCompletedDoc(d, "a");

    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });

    const [row] = await d
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.status).toBe("draft_ready");
  });

  it("is idempotent — calling twice in a row is a no-op the second time", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({ status: "extracting" })
      .where(eq(cases.id, CASE_ID));
    await insertCompletedDoc(d, "a");

    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });
    await reconcileCaseAfterExtraction({ conn: d as never, caseId: CASE_ID });

    const events = await d
      .select({ eventType: caseEvents.eventType })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, CASE_ID));
    // Exactly one status_changed event despite two reconcile calls.
    expect(
      events.filter((e) => e.eventType === "case.status_changed"),
    ).toHaveLength(1);
  });
});

async function seedBase(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Attorney",
    email: "readiness@docket.local",
  });
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Org", slug: "readiness-test-org" });
  await d.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await d.insert(cases).values({
    id: CASE_ID,
    organizationId: ORG,
    visaType: "O-1A",
    status: "ready_to_build",
    beneficiaryData: { fullName: "Test Beneficiary 001" },
  });
}

async function insertCompletedDoc(d: TestDb, suffix: string): Promise<void> {
  await d.insert(caseDocuments).values({
    caseId: CASE_ID,
    uploadedBy: ATTORNEY,
    documentType: "cv_resume",
    originalFilename: `cv-${suffix}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1n,
    sha256: suffix.padEnd(64, "0"),
    storagePath: `/t/cv-${suffix}.pdf`,
    extractionStatus: "completed",
    extractedText: "extracted prose",
  });
}

async function insertDocWithStatus(
  d: TestDb,
  suffix: string,
  status: "pending" | "processing" | "completed" | "failed",
): Promise<void> {
  await d.insert(caseDocuments).values({
    caseId: CASE_ID,
    uploadedBy: ATTORNEY,
    documentType: "cv_resume",
    originalFilename: `cv-${suffix}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1n,
    sha256: suffix.padEnd(64, "0"),
    storagePath: `/t/cv-${suffix}.pdf`,
    extractionStatus: status,
  });
}
