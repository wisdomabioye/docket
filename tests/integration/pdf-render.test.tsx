// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  caseOutputs,
  caseParticipants,
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
  compileFullPackagePdf,
  renderPdfToBuffer,
  renderPerOutputPdf,
} from "@/server/services/pdf";
import { CoverPage } from "@/server/services/pdf/cover";

/**
 * Stage 08 PDF render pipeline. Verifies:
 *   - Per-output PDF renders to a non-empty Buffer.
 *   - Package compile rejects when nothing is approved (defense-in-depth
 *     for the UI's hidden-button rule).
 *   - Package compile renders a non-empty Buffer when ≥1 output is
 *     approved.
 *   - Non-Latin beneficiary names render without throwing (Unicode
 *     fallback). We don't assert glyph fidelity — that's a font-config
 *     concern; we just lock that the renderer doesn't crash on
 *     `Иван Иванов` / `张伟` (legacy bug class in @react-pdf/renderer).
 *   - Cover page alone renders (smoke test for the shared template).
 */

const ATTORNEY = "e1000000-0000-4000-8000-aaaa00000001";
const ORG = "e1000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "e1000000-0000-4000-8000-cccc00000001";

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

describe("CoverPage smoke render", () => {
  it("renders to a non-empty Buffer", async () => {
    const { Document } = await import("@react-pdf/renderer");
    const buffer = await renderPdfToBuffer(
      <Document>
        <CoverPage
          title="Test"
          beneficiaryName="Test Beneficiary 001"
          visaType="O-1A"
          attorneyName="Test Attorney"
          generatedDateLabel="2026-04-29"
        />
      </Document>,
    );
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});

describe("renderPerOutputPdf", () => {
  it("throws NOT_FOUND when caseId doesn't exist", async (ctx) => {
    const d = gate(ctx);
    await expect(
      renderPerOutputPdf({
        db: d as never,
        caseId: "00000000-0000-4000-8000-000000000000",
        outputId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when outputId is not among current outputs (older version)", async (ctx) => {
    const d = gate(ctx);
    // Insert a non-current row.
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: false,
        author: "computer",
        content: "older version",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");
    await expect(
      renderPerOutputPdf({
        db: d as never,
        caseId: CASE_ID,
        outputId: out.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("renders a per-output PDF for an approved current output", async (ctx) => {
    const d = gate(ctx);
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content:
          "# Personal Statement\n\nI am a researcher in **artificial intelligence**.\n\n- Achievement A\n- Achievement B",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");

    const result = await renderPerOutputPdf({
      db: d as never,
      caseId: CASE_ID,
      outputId: out.id,
    });
    expect(result.url).toMatch(/^https?:|^\//);
    expect(result.bytes).toBeGreaterThan(1000);
  });

  it("rejects when the current output has empty content", async (ctx) => {
    const d = gate(ctx);
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");

    await expect(
      renderPerOutputPdf({
        db: d as never,
        caseId: CASE_ID,
        outputId: out.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renders a non-Latin beneficiary name without crashing", async (ctx) => {
    const d = gate(ctx);
    await d
      .update(cases)
      .set({
        beneficiaryData: { fullName: "Иван Иванов" },
      })
      .where(eq(cases.id, CASE_ID));
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "I am a researcher.",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");

    const result = await renderPerOutputPdf({
      db: d as never,
      caseId: CASE_ID,
      outputId: out.id,
    });
    expect(result.bytes).toBeGreaterThan(1000);
  });
});

describe("compileFullPackagePdf", () => {
  it("throws NOT_FOUND when caseId doesn't exist (loadCoverFields gate)", async (ctx) => {
    const d = gate(ctx);
    await expect(
      compileFullPackagePdf({
        db: d as never,
        caseId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects with BAD_REQUEST when zero outputs are approved", async (ctx) => {
    const d = gate(ctx);
    // Insert an output but DON'T mark it approved.
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "personal_statement",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: "draft",
      attorneyApproved: false,
    });
    await expect(
      compileFullPackagePdf({ db: d as never, caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renders the package when ≥1 output is approved", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "I am a researcher.",
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
      {
        caseId: CASE_ID,
        outputType: "petition_letter",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "## Petition\n\nThe beneficiary is qualified.",
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
    ]);
    const result = await compileFullPackagePdf({
      db: d as never,
      caseId: CASE_ID,
    });
    expect(result.bytes).toBeGreaterThan(1500);
  });

  it("includes per-recommender letters with subtitle metadata path", async (ctx) => {
    const d = gate(ctx);
    // Two approved recommendation letters, each with a subgroup_key
    // and a recommenderName in metadata. Hits `bodyDescriptorFor`'s
    // `recommendation_letter_template` branch + `readRecommenderName`.
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "Letter from Dr. Doe.",
        subgroupKey: "rec-1",
        metadata: {
          type: "recommendation_letter_template",
          recommenderName: "Jane Doe",
        },
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
      {
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "Letter from Prof. Smith.",
        subgroupKey: "rec-2",
        metadata: {
          type: "recommendation_letter_template",
          recommenderName: "John Smith",
        },
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
    ]);
    const result = await compileFullPackagePdf({
      db: d as never,
      caseId: CASE_ID,
    });
    expect(result.bytes).toBeGreaterThan(2000);
  });

  it("includes an exhibit_index output (exhibitCount metadata path)", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "exhibit_index",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: "1. Exhibit A — CV\n2. Exhibit B — Publications",
      metadata: {
        type: "exhibit_index",
        exhibitCount: 2,
      },
      attorneyApproved: true,
      approvedAt: new Date(),
      approvedBy: ATTORNEY,
    });
    const result = await compileFullPackagePdf({
      db: d as never,
      caseId: CASE_ID,
    });
    expect(result.bytes).toBeGreaterThan(1500);
  });

  it("excludes unapproved outputs from the package", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "approved one",
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
      {
        caseId: CASE_ID,
        outputType: "petition_letter",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "unapproved",
        attorneyApproved: false,
      },
    ]);
    const approvedSize = (
      await compileFullPackagePdf({ db: d as never, caseId: CASE_ID })
    ).bytes;

    // Approve the second too — package grows.
    await d
      .update(caseOutputs)
      .set({ attorneyApproved: true, approvedBy: ATTORNEY, approvedAt: new Date() })
      .where(eq(caseOutputs.outputType, "petition_letter"));
    const bothSize = (
      await compileFullPackagePdf({ db: d as never, caseId: CASE_ID })
    ).bytes;

    expect(bothSize).toBeGreaterThan(approvedSize);
  });

  it("renders multi-page markdown content without pdfkit translate failure (open_issues #54)", async (ctx) => {
    const d = gate(ctx);
    // Pre-fix: a paginated MarkdownRenderer body alongside the
    // DisclaimerFooter's two `<Text fixed>` siblings (disclaimer +
    // page-number-with-`render`-callback) corrupted react-pdf's layout
    // and threw `unsupported number: -1.83…e+21` from PDFDocument.translate.
    // Existing fixtures use one-paragraph content so multi-page never
    // got exercised. This seeds enough markdown sections to span 3+ pages
    // and asserts the package compiles.
    const longContent = Array.from({ length: 40 }, (_, i) =>
      `## Section ${i + 1}\n\n` + "prose words ".repeat(40),
    ).join("\n\n");
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "petition_letter",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: longContent,
      attorneyApproved: true,
      approvedAt: new Date(),
      approvedBy: ATTORNEY,
    });
    const result = await compileFullPackagePdf({
      db: d as never,
      caseId: CASE_ID,
    });
    expect(result.bytes).toBeGreaterThan(5000);
  });
});

async function seedBase(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Test Attorney",
    email: "pdf@docket.local",
  });
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Org", slug: "pdf-test-org" });
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
    status: "draft_ready",
    beneficiaryData: { fullName: "Test Beneficiary 001" },
  });
  await d.insert(caseParticipants).values({
    caseId: CASE_ID,
    userId: ATTORNEY,
    role: "attorney",
    isPrimary: true,
  });
}
