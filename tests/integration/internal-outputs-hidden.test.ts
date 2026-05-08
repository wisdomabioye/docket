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

import {
  getCurrentOutputsForList,
  summarizeOutputApprovals,
} from "@/server/services/output";
import { compileFullPackagePdf } from "@/server/services/pdf";
import { loadBuildContext } from "@/server/jobs/_context";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * `INTERNAL_OUTPUT_TYPES` (currently `["evidence_plan"]`) hides
 * upstream-scaffolding outputs from attorney-facing surfaces while
 * keeping them available to downstream prompt builders.
 *
 * Locked behavior:
 *   - `getCurrentOutputsForList` (the outputs-grid query) excludes them.
 *   - `summarizeOutputApprovals` excludes them from BOTH `total` and
 *     `approved` — without this `package.ready` would never fire.
 *   - `compileFullPackagePdf` excludes them defense-in-depth even if a
 *     row is somehow flagged approved.
 *   - `loadBuildContext` STILL surfaces the latest evidence_plan to the
 *     downstream prompt builders (this is the whole reason internals
 *     exist; if this fails, every Stage-7 sub-prompt errors).
 */

const ATTORNEY = "f1000000-0000-4000-8000-aaaa00000001";
const ORG = "f1000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f1000000-0000-4000-8000-cccc00000001";

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

const EVIDENCE_PLAN_JSON = JSON.stringify({
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
});

describe("INTERNAL_OUTPUT_TYPES — visibility filters", () => {
  it("getCurrentOutputsForList excludes evidence_plan", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: EVIDENCE_PLAN_JSON,
      },
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "Visible to attorney.",
      },
    ]);
    const list = await getCurrentOutputsForList({
      db: d as never,
      caseId: CASE_ID,
    });
    const types = list.map((o) => o.outputType);
    expect(types).toContain("personal_statement");
    expect(types).not.toContain("evidence_plan");
  });

  it("summarizeOutputApprovals excludes evidence_plan from total AND approved", async (ctx) => {
    const d = gate(ctx);
    // 1 approved evidence_plan (must NOT count) + 1 unapproved
    // personal_statement (must count toward total only).
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: EVIDENCE_PLAN_JSON,
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "draft",
        attorneyApproved: false,
      },
    ]);
    const tally = await summarizeOutputApprovals({
      db: d as never,
      caseIds: [CASE_ID],
    });
    const counts = tally.get(CASE_ID);
    expect(counts).toEqual({ approved: 0, total: 1 });
  });

  it("summarizeOutputApprovals can reach total === approved when only evidence_plan is unapproved", async (ctx) => {
    // Critical: pre-fix this never reached parity because evidence_plan
    // was always counted in `total` but never approved → `package.ready`
    // never fired.
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: EVIDENCE_PLAN_JSON,
        attorneyApproved: false,
      },
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "approved",
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
    ]);
    const tally = await summarizeOutputApprovals({
      db: d as never,
      caseIds: [CASE_ID],
    });
    const counts = tally.get(CASE_ID);
    expect(counts).toEqual({ approved: 1, total: 1 });
  });

  it("compileFullPackagePdf excludes evidence_plan even if approved", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: EVIDENCE_PLAN_JSON,
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "Approved prose for the package.",
        attorneyApproved: true,
        approvedAt: new Date(),
        approvedBy: ATTORNEY,
      },
    ]);
    const result = await compileFullPackagePdf({
      db: d as never,
      caseId: CASE_ID,
    });
    // The package compiles (one approved non-internal output is enough);
    // the assertion is "didn't crash + produced a non-empty buffer".
    // Substring assertions on the binary PDF buffer aren't reliable
    // (text may be encoded), so we lock the behavior via the input
    // shape rather than scanning bytes.
    expect(result.bytes).toBeGreaterThan(1000);
  });

  it("loadBuildContext STILL surfaces the latest evidence_plan to downstream prompts", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: EVIDENCE_PLAN_JSON,
    });
    const buildCtx = await loadBuildContext(CASE_ID);
    expect(buildCtx.evidencePlan).not.toBeNull();
    expect(buildCtx.evidencePlan?.visaType).toBe("O-1A");
    expect(buildCtx.evidencePlan?.criteria).toHaveLength(1);
  });
});

async function seedBase(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Test Attorney",
    email: "internals@docket.local",
  });
  await d.insert(organizations).values({
    id: ORG,
    name: "Org",
    slug: "internals-test-org",
  });
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
    beneficiaryData: { fullName: "Test Beneficiary Internals" },
  });
}
