// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caseOutputs,
  cases,
  organizationMembers,
  organizations,
  users,
} from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import { loadBuildContext } from "@/server/jobs/_context";
import { MockComputerClient } from "@/server/services/computer/mock";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * `loadBuildContext` resolves the evidence plan from `case_outputs`
 * (Stage 08 / open_issues #21). Migration 0012 dropped the
 * `cases.evidence_plan` jsonb cache that previously diverged from the
 * row written by the evidence-plan sub-function.
 *
 * Locked behaviors:
 *   - Latest `is_current=true` evidence_plan row populates `ctx.evidencePlan`.
 *   - No evidence-plan row → `null`.
 *   - Soft-deleted evidence-plan row → `null` (filtered out).
 *   - Malformed JSON content → `null` (parse failure swallowed; downstream
 *     prompts throw, surfacing the inconsistency).
 *   - Schema-mismatch JSON → `null` (Zod safeParse fails).
 */

const ATTORNEY = "d9000000-0000-4000-8000-aaaa00000001";
const ORG = "d9000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d9000000-0000-4000-8000-cccc00000001";

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
  await seedBaseCase(db);
});

afterAll(async () => {
  await closeTestDb();
});

const validPlanJson = JSON.stringify({
  visaType: "O-1A",
  overallStrength: "moderate",
  criteria: [
    { criterion: "Awards", assessment: "moderate", summary: "ok", gaps: [] },
  ],
  generatedAt: new Date().toISOString(),
});

describe("loadBuildContext — evidence plan source (#21)", () => {
  it("returns null when no evidence_plan row exists", async (ctx) => {
    gate(ctx);
    const r = await loadBuildContext(CASE_ID);
    expect(r.evidencePlan).toBeNull();
  });

  it("populates evidencePlan from the current evidence_plan row", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: validPlanJson,
    });
    const r = await loadBuildContext(CASE_ID);
    expect(r.evidencePlan).toMatchObject({
      visaType: "O-1A",
      overallStrength: "moderate",
    });
    expect(r.evidencePlan?.criteria).toHaveLength(1);
  });

  it("ignores soft-deleted evidence_plan rows", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: validPlanJson,
      deletedAt: new Date(),
    });
    const r = await loadBuildContext(CASE_ID);
    expect(r.evidencePlan).toBeNull();
  });

  it("returns null on malformed JSON content (parse failure)", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: "not valid json {",
    });
    const r = await loadBuildContext(CASE_ID);
    expect(r.evidencePlan).toBeNull();
  });

  // REGRESSION: in dev (no PERPLEXITY_API_KEY) the build pipeline runs
  // through `MockComputerClient`. When the mock saved a non-conforming
  // payload to the evidence_plan row, this loader returned null,
  // and every dependent prompt threw "evidencePlan must be populated".
  // The chain was broken end-to-end for the dev workflow.
  it("populates evidencePlan from MockComputerClient output (dev pipeline)", async (ctx) => {
    const d = gate(ctx);
    const mock = new MockComputerClient();
    const out = await mock.generate({
      systemPrompt: "system",
      userPrompt: "user",
      jsonSchema: { name: "evidence_plan", schema: { type: "object" } },
      metadata: {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        sessionId: "test",
      },
    });
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: out.text,
    });
    const r = await loadBuildContext(CASE_ID);
    expect(r.evidencePlan).not.toBeNull();
    expect(r.evidencePlan?.visaType).toBe("O-1A");
    expect(r.evidencePlan?.criteria.length).toBeGreaterThan(0);
  });

  it("returns null when JSON parses but doesn't match EvidencePlanSchema", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      // Missing required fields like criteria + generatedAt.
      content: JSON.stringify({ visaType: "O-1A" }),
    });
    const r = await loadBuildContext(CASE_ID);
    expect(r.evidencePlan).toBeNull();
  });
});

async function seedBaseCase(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Attorney",
    email: "ep@docket.local",
  });
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Org", slug: "ep-loader-test-org" });
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
  });
}
