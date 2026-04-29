// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * `loadBuildContext` is the single read-pass the parent + regenerate
 * functions use. We lock down: visa type + beneficiary blob land
 * verbatim, documents come back with `truncated` flagged correctly,
 * recommenders is empty (until Stage 5 stores them), and a missing
 * case throws.
 */

const ATTORNEY = "d3000000-0000-4000-8000-aaaa00000001";
const ORG = "d3000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d3000000-0000-4000-8000-cccc00000001";
const DOC_ID_SHORT = "d3000000-0000-4000-8000-dddd00000001";
const DOC_ID_LONG = "d3000000-0000-4000-8000-dddd00000002";

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

describe("loadBuildContext", () => {
  it("returns visa type, beneficiary, snapshotAt, and documents", async (ctx) => {
    gate(ctx);
    const { loadBuildContext } = await import("@/server/jobs/_context");
    const result = await loadBuildContext(CASE_ID);
    expect(result.caseId).toBe(CASE_ID);
    expect(result.visaType).toBe("O-1A");
    expect(result.beneficiary).toEqual({
      fullName: "Test Beneficiary 001",
      occupation: "Researcher",
    });
    expect(result.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.recommenders).toEqual([]);
    expect(result.evidencePlan).toBeNull();
    expect(result.documents).toHaveLength(2);
  });

  it("flags truncation only on docs with text > 50k chars", async (ctx) => {
    gate(ctx);
    const { loadBuildContext, DOCUMENT_TEXT_BUDGET } = await import(
      "@/server/jobs/_context"
    );
    const result = await loadBuildContext(CASE_ID);
    const shortDoc = result.documents.find((d) => d.id === DOC_ID_SHORT);
    const longDoc = result.documents.find((d) => d.id === DOC_ID_LONG);
    expect(shortDoc?.truncated).toBe(false);
    expect(longDoc?.truncated).toBe(true);
    expect(longDoc?.extractedText.length).toBe(DOCUMENT_TEXT_BUDGET);
  });

  it("throws NOT_FOUND when the case is missing", async (ctx) => {
    gate(ctx);
    const { loadBuildContext } = await import("@/server/jobs/_context");
    await expect(
      loadBuildContext("00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    .values({ id: ORG, name: "Org", slug: "load-context-test-org" });
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
    beneficiaryData: {
      fullName: "Test Beneficiary 001",
      occupation: "Researcher",
    },
  });
  await d.insert(caseDocuments).values([
    {
      id: DOC_ID_SHORT,
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "cv_resume",
      originalFilename: "cv.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000n,
      sha256: "a".repeat(64),
      storagePath: "/test/cv.pdf",
      extractionStatus: "completed",
      extractedText: "short text",
    },
    {
      id: DOC_ID_LONG,
      caseId: CASE_ID,
      uploadedBy: ATTORNEY,
      documentType: "publication",
      originalFilename: "paper.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_000_000n,
      sha256: "b".repeat(64),
      storagePath: "/test/paper.pdf",
      extractionStatus: "completed",
      // 60k chars > 50k budget → truncation expected.
      extractedText: "x".repeat(60_000),
    },
  ]);
}
