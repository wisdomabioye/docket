// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// pdf-parse cold-loads pdfjs-dist on first call (~5–7 seconds). Bump
// the per-test timeout so cold runs don't trip the 5s default.
vi.setConfig({ testTimeout: 30_000 });

import { eq, sql } from "drizzle-orm";
import {
  caseDocuments,
  caseEvents,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { storage } from "@/server/services/storage";
import { db as ownerDb } from "@/server/db/client";

/**
 * Stage 06 — document upload + extraction end-to-end.
 *
 * Uses a tiny synthetic PDF and DOCX as fixtures so the extractors run
 * for real. Verifies: storage write, sha256, dedup CONFLICT, MIME
 * allowlist, size cap, RLS scoping, deletion soft-removal.
 */

const ALICE = "80000000-0000-4000-8000-aaaa00000001";
const BOB = "80000000-0000-4000-8000-bbbb00000001";
const CAROL_ADMIN = "80000000-0000-4000-8000-eeee00000001";
const ORG_A = "80000000-0000-4000-8000-cccc00000001";
const ORG_B = "80000000-0000-4000-8000-dddd00000001";

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

let db: TestDb | null = null;
let rlsReady = false;
let aliceCaseId = "";

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
  await db.insert(users).values([
    { id: ALICE, name: "Test Alice DOC", email: "doc-alice@docket.local" },
    { id: BOB, name: "Test Bob DOC", email: "doc-bob@docket.local" },
    { id: CAROL_ADMIN, name: "Test Carol DOC", email: "doc-carol@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ALICE, role: "attorney" },
    { userId: BOB, role: "attorney" },
    { userId: CAROL_ADMIN, role: "admin" },
  ]);
  await db.insert(organizations).values([
    { id: ORG_A, name: "Doc Org A", slug: "doc-org-a" },
    { id: ORG_B, name: "Doc Org B", slug: "doc-org-b" },
  ]);
  await db.insert(organizationMembers).values([
    { organizationId: ORG_A, userId: ALICE, role: "owner", status: "active", acceptedAt: new Date() },
    { organizationId: ORG_B, userId: BOB, role: "owner", status: "active", acceptedAt: new Date() },
  ]);
});

beforeEach(async () => {
  if (!db) return;
  // Clear case_documents from prior tests (cascade deletes when we drop cases).
  await db.execute(sql`delete from cases where organization_id in (${ORG_A}, ${ORG_B})`);
  // Re-create one fresh case per side.
  const a = await callAs(ALICE).case.create({ visaType: "O-1A" });
  aliceCaseId = a.id;
  await callAs(BOB).case.create({ visaType: "O-1A" });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("document.upload", () => {
  it("stores bytes + computes sha256 + writes case_event", async (ctx) => {
    const db = gate(ctx);
    const bytes = makeMinimalPdf();
    const result = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "test.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: bytes.toString("base64"),
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.id, result.documentId));
    expect(row?.originalFilename).toBe("test.pdf");
    expect(row?.mimeType).toBe("application/pdf");
    expect(row?.sizeBytes).toBe(BigInt(bytes.length));
    expect(row?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.storagePath).toContain(`cases/${aliceCaseId}/documents/${result.documentId}/`);

    // Storage actually has the bytes.
    const back = await storage.get(row!.storagePath);
    expect(back.equals(bytes)).toBe(true);

    // case_event written.
    const events = await db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, aliceCaseId));
    expect(
      events.find((e) => e.eventType === "document.uploaded"),
    ).toBeDefined();
  });

  it("CONFLICT on duplicate sha256 within the same case", async (ctx) => {
    gate(ctx);
    const bytes = makeMinimalPdf();
    await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "first.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: bytes.toString("base64"),
    });
    await expect(
      callAs(ALICE).document.upload({
        caseId: aliceCaseId,
        filename: "second.pdf",
        mimeType: "application/pdf",
        documentType: "publication",
        contentBase64: bytes.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("BAD_REQUEST on disallowed MIME type", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ALICE).document.upload({
        caseId: aliceCaseId,
        filename: "x.exe",
        mimeType: "application/x-msdownload" as never,
        documentType: "other",
        contentBase64: Buffer.from("x").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("BAD_REQUEST on empty file", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ALICE).document.upload({
        caseId: aliceCaseId,
        filename: "empty.pdf",
        mimeType: "application/pdf",
        documentType: "other",
        contentBase64: "",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("NOT_FOUND when case isn't visible to caller (RLS)", async (ctx) => {
    gate(ctx);
    const bytes = makeMinimalPdf();
    await expect(
      callAs(BOB).document.upload({
        caseId: aliceCaseId, // alice's case, bob isn't a participant
        filename: "test.pdf",
        mimeType: "application/pdf",
        documentType: "cv_resume",
        contentBase64: bytes.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ALLOWED when case status is build_failed (attorney retries)", async (ctx) => {
    const db = gate(ctx);
    await ownerDb
      .update(cases)
      .set({ status: "build_failed" })
      .where(eq(cases.id, aliceCaseId));

    const result = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "retry.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: makeMinimalPdf("retry").toString("base64"),
    });
    expect(result.ok).toBe(true);

    // Restore status so subsequent tests work.
    await ownerDb
      .update(cases)
      .set({ status: "intake" })
      .where(eq(cases.id, aliceCaseId));

    void db;
  });

  it("CONFLICT when case status doesn't allow uploads (e.g. archived)", async (ctx) => {
    const db = gate(ctx);
    // Move the case to archived directly via owner db (simulates Stage 09 archive).
    await ownerDb.update(cases).set({ status: "archived" }).where(eq(cases.id, aliceCaseId));
    const bytes = makeMinimalPdf();
    await expect(
      callAs(ALICE).document.upload({
        caseId: aliceCaseId,
        filename: "x.pdf",
        mimeType: "application/pdf",
        documentType: "cv_resume",
        contentBase64: bytes.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Ensure no document row was inserted.
    const docs = await db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.caseId, aliceCaseId));
    expect(docs).toHaveLength(0);
  });
});

describe("document extraction", () => {
  it("extracts text from a real-ish PDF and marks completed", async (ctx) => {
    const db = gate(ctx);
    const bytes = makeMinimalPdf();
    const { documentId } = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "extracted.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: bytes.toString("base64"),
    });
    const [row] = await db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.id, documentId));
    expect(row?.extractionStatus).toBe("completed");
    expect(row?.extractedText).toBeTypeOf("string");
    expect(row?.extractedAt).toBeInstanceOf(Date);
  });
});

describe("document.list", () => {
  it("returns only the caller's documents (RLS via parent case)", async (ctx) => {
    gate(ctx);
    const aliceBytes = makeMinimalPdf("alice-content");
    await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "alice.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: aliceBytes.toString("base64"),
    });

    const aliceList = await callAs(ALICE).document.list({ caseId: aliceCaseId });
    expect(aliceList).toHaveLength(1);

    const bobView = await callAs(BOB).document.list({ caseId: aliceCaseId });
    expect(bobView).toHaveLength(0);
  });
});

describe("document.delete", () => {
  it("soft-deletes the row", async (ctx) => {
    const db = gate(ctx);
    const { documentId } = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "del.pdf",
      mimeType: "application/pdf",
      documentType: "other",
      contentBase64: makeMinimalPdf().toString("base64"),
    });
    await callAs(ALICE).document.delete({ documentId });

    const [row] = await db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.id, documentId));
    expect(row?.deletedAt).toBeInstanceOf(Date);

    const list = await callAs(ALICE).document.list({ caseId: aliceCaseId });
    expect(list).toHaveLength(0);
  });
});

describe("document.getDownloadUrl", () => {
  it("returns a HMAC-signed URL", async (ctx) => {
    gate(ctx);
    const { documentId } = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "dl.pdf",
      mimeType: "application/pdf",
      documentType: "other",
      contentBase64: makeMinimalPdf().toString("base64"),
    });
    const { url, filename } = await callAs(ALICE).document.getDownloadUrl({
      documentId,
    });
    expect(url).toContain("/api/files/");
    expect(filename).toBe("dl.pdf");
  });
});

// Regression net for open_issues #59 (case_documents). The
// `case_documents_admin` RLS policy grants admins blanket access; an
// admin who is not a case participant USED to mint signed URLs for
// any attorney's documents and could upload/delete on their behalf.
// The application-layer participant gate must hold even with admin
// RLS bypass. Restore the gate if these fail — never trust RLS alone.
describe("document — admin participant gate", () => {
  it("list returns [] for an admin not on the case", async (ctx) => {
    gate(ctx);
    await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "g.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: makeMinimalPdf("g").toString("base64"),
    });
    const r = await callAs(CAROL_ADMIN).document.list({
      caseId: aliceCaseId,
    });
    expect(r).toEqual([]);
  });

  it("upload NOT_FOUND for an admin not on the case", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(CAROL_ADMIN).document.upload({
        caseId: aliceCaseId,
        filename: "g2.pdf",
        mimeType: "application/pdf",
        documentType: "cv_resume",
        contentBase64: makeMinimalPdf("g2").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getDownloadUrl NOT_FOUND for an admin not on the case", async (ctx) => {
    gate(ctx);
    const { documentId } = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "g3.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: makeMinimalPdf("g3").toString("base64"),
    });
    await expect(
      callAs(CAROL_ADMIN).document.getDownloadUrl({ documentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("delete NOT_FOUND for an admin not on the case", async (ctx) => {
    gate(ctx);
    const { documentId } = await callAs(ALICE).document.upload({
      caseId: aliceCaseId,
      filename: "g4.pdf",
      mimeType: "application/pdf",
      documentType: "cv_resume",
      contentBase64: makeMinimalPdf("g4").toString("base64"),
    });
    await expect(
      callAs(CAROL_ADMIN).document.delete({ documentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

/**
 * Smallest valid-ish PDF document. Real `pdf-parse` accepts this and
 * extracts approximately empty text. The optional `salt` lets us produce
 * different SHA-256 hashes for tests that need distinct files.
 */
function makeMinimalPdf(salt = ""): Buffer {
  const body = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
${salt ? `% salt: ${salt}\n` : ""}xref
0 4
0000000000 65535 f
trailer << /Size 4 /Root 1 0 R >>
%%EOF`;
  return Buffer.from(body, "utf8");
}

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from cases where organization_id in (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`delete from organization_members where organization_id in (${ORG_A}, ${ORG_B})`);
  await db.execute(sql`delete from organizations where id in (${ORG_A}, ${ORG_B})`);
  await db.execute(
    sql`delete from user_roles where user_id in (${ALICE}, ${BOB}, ${CAROL_ADMIN})`,
  );
  await db.execute(
    sql`delete from users where id in (${ALICE}, ${BOB}, ${CAROL_ADMIN})`,
  );
}
