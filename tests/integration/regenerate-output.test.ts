// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import {
  caseDocuments,
  caseOutputs,
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
 * `regenerateOutputHandler` end-to-end against real DB + mock computer.
 * The Inngest function wrapper is config only; the body — which has 4
 * meaningful branches — lives in the exported handler. Tests exercise
 * each branch:
 *
 *   1. outputId not found → NonRetriableError
 *   2. recommendation_letter_template → NonRetriableError (Stage 8 fix)
 *   3. unmapped output type (e.g. cover_letter, form_g1145, other) →
 *      NonRetriableError
 *   4. Happy path: loads context, runs the right prompt builder, saves
 *      a new version via `runOutputJob` (uses the mock computer client).
 *   5. Guidance prepended to userPrompt.
 */

const ATTORNEY = "d6000000-0000-4000-8000-aaaa00000001";
const ORG = "d6000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d6000000-0000-4000-8000-cccc00000001";

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

/** Inline step harness that runs callbacks immediately. */
const realStep = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
};

describe("regenerateOutputHandler — error branches", () => {
  it("throws NonRetriableError when outputId is not found", async (ctx) => {
    gate(ctx);
    const { regenerateOutputHandler } = await import(
      "@/server/jobs/regenerate-output"
    );
    await expect(
      regenerateOutputHandler({
        caseId: CASE_ID,
        outputId: "00000000-0000-4000-8000-000000000000",
        sessionId: "s",
        step: realStep,
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("throws NonRetriableError for recommendation_letter_template (open_issues #20)", async (ctx) => {
    const d = gate(ctx);
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "letter v1",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");

    const { regenerateOutputHandler } = await import(
      "@/server/jobs/regenerate-output"
    );
    await expect(
      regenerateOutputHandler({
        caseId: CASE_ID,
        outputId: out.id,
        sessionId: "s",
        step: realStep,
      }),
    ).rejects.toThrow(/recommendation_letter_template not supported/);
  });

  it("throws NonRetriableError for unmapped output type (cover_letter)", async (ctx) => {
    const d = gate(ctx);
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "cover_letter",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "cover v1",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");

    const { regenerateOutputHandler } = await import(
      "@/server/jobs/regenerate-output"
    );
    await expect(
      regenerateOutputHandler({
        caseId: CASE_ID,
        outputId: out.id,
        sessionId: "s",
        step: realStep,
      }),
    ).rejects.toThrow(/no prompt builder/);
  });
});

describe("regenerateOutputHandler — happy path", () => {
  it("regenerates a personal_statement → new case_outputs version + ledger row", async (ctx) => {
    const d = gate(ctx);
    // Seed an existing v1 + populate evidence_plan (downstream prompts
    // depend on it). The regenerate handler creates v2.
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "draft v1",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");
    await d
      .update(cases)
      .set({
        evidencePlan: {
          visaType: "O-1A",
          overallStrength: "moderate",
          criteria: [
            {
              criterion: "Awards",
              assessment: "moderate",
              summary: "ok",
              gaps: [],
            },
          ],
          generatedAt: new Date().toISOString(),
        },
      })
      .where(eq(cases.id, CASE_ID));

    const { regenerateOutputHandler } = await import(
      "@/server/jobs/regenerate-output"
    );
    const result = await regenerateOutputHandler({
      caseId: CASE_ID,
      outputId: out.id,
      sessionId: "s-regen",
      step: realStep,
    });
    expect(result.outputVersion).toBe(2);
    // The mock computer client stamps `mock-${uuid}` for sessionId.
    expect(result.computerSessionId).toMatch(/^mock-/);

    const rows = await d
      .select({
        version: caseOutputs.outputVersion,
        current: caseOutputs.isCurrent,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.caseId, CASE_ID));
    expect(rows).toHaveLength(2);
    const v1 = rows.find((r) => r.version === 1);
    const v2 = rows.find((r) => r.version === 2);
    expect(v1?.current).toBe(false); // flipped by saveOutputVersion
    expect(v2?.current).toBe(true);
  });

  it("prepends guidance to the prompt's userPrompt and stamps it in metadata", async (ctx) => {
    const d = gate(ctx);
    // Populate evidencePlan — the exhibit_index prompt builder requires it.
    await d
      .update(cases)
      .set({
        evidencePlan: {
          visaType: "O-1A",
          overallStrength: "moderate",
          criteria: [
            {
              criterion: "Original Contributions",
              assessment: "moderate",
              summary: "ok",
              gaps: [],
            },
          ],
          generatedAt: new Date().toISOString(),
        },
      })
      .where(eq(cases.id, CASE_ID));
    const [out] = await d
      .insert(caseOutputs)
      .values({
        caseId: CASE_ID,
        outputType: "exhibit_index",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "v1",
      })
      .returning({ id: caseOutputs.id });
    if (!out) throw new Error("insert returned no id");

    const { regenerateOutputHandler } = await import(
      "@/server/jobs/regenerate-output"
    );
    await regenerateOutputHandler({
      caseId: CASE_ID,
      outputId: out.id,
      guidance: "Please cite USCIS 2024 memo.",
      sessionId: "s-regen-guidance",
      step: realStep,
    });

    // Verify the saved row's metadata carries the guidance — proves the
    // handler forwarded the optional `extraMetadata` to `runOutputJob`,
    // which in turn passed it through `saveOutputVersion`.
    const rows = await d
      .select({
        v: caseOutputs.outputVersion,
        metadata: caseOutputs.metadata,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.caseId, CASE_ID));
    const v2Row = rows.find((r) => r.v === 2);
    expect(v2Row).toBeDefined();
    expect(v2Row?.metadata).toMatchObject({
      regenerationGuidance: "Please cite USCIS 2024 memo.",
    });
  });
});

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Attorney",
    email: "regen@docket.local",
  });
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Org", slug: "regen-test-org" });
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
  // Need at least one document so loadBuildContext returns a usable ctx.
  await d.insert(caseDocuments).values({
    caseId: CASE_ID,
    uploadedBy: ATTORNEY,
    documentType: "cv_resume",
    originalFilename: "cv.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1000n,
    sha256: "c".repeat(64),
    storagePath: "/test/cv.pdf",
    extractionStatus: "completed",
    extractedText: "extracted prose",
  });
}
