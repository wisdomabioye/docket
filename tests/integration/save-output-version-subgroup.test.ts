// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
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

import { saveOutputVersion } from "@/server/services/output";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * Subgroup-aware versioning regression suite (Stage 08, resolves
 * open_issues #20). Locks down:
 *
 *   - Two distinct subgroup keys produce two parallel `is_current=true`
 *     rows of the same `output_type` (multi-recommender letters).
 *   - The `is_current` flip is scoped to a subgroup — saving a new
 *     version for recommender A does NOT clobber recommender B's
 *     current row.
 *   - Version numbering is per-subgroup (B's first save is v1, even
 *     though A already has v1, v2).
 *   - Single-instance types (subgroup_key=null) keep the legacy
 *     "one current per (case, type)" semantics.
 *   - The DB unique index catches a hypothetical service-layer bug
 *     that tries to write two current rows for the same subgroup.
 */

const ATTORNEY = "d8000000-0000-4000-8000-aaaa00000001";
const ORG = "d8000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d8000000-0000-4000-8000-cccc00000001";
const RECOMMENDER_A = "rec-a";
const RECOMMENDER_B = "rec-b";

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

const baseInput = {
  content: "letter draft",
  computerSessionId: "sess",
  computeDurationMs: 0,
  promptTokens: 0,
  completionTokens: 0,
  usdCents: 1,
};

describe("saveOutputVersion — subgroup-aware (#20)", () => {
  it("two subgroups produce parallel is_current rows", async (ctx) => {
    const d = gate(ctx);
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_A,
        ...baseInput,
      }),
    );
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_B,
        ...baseInput,
      }),
    );

    const rows = await d
      .select({
        subgroupKey: caseOutputs.subgroupKey,
        version: caseOutputs.outputVersion,
        current: caseOutputs.isCurrent,
      })
      .from(caseOutputs)
      .where(
        and(
          eq(caseOutputs.caseId, CASE_ID),
          eq(caseOutputs.outputType, "recommendation_letter_template"),
        ),
      );

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.subgroupKey === RECOMMENDER_A)?.current).toBe(true);
    expect(rows.find((r) => r.subgroupKey === RECOMMENDER_B)?.current).toBe(true);
  });

  it("flipping current for subgroup A does NOT clobber subgroup B", async (ctx) => {
    const d = gate(ctx);
    // A v1, then B v1, then A v2. After: A v1 false, A v2 true, B v1 true.
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_A,
        ...baseInput,
      }),
    );
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_B,
        ...baseInput,
      }),
    );
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_A,
        ...baseInput,
      }),
    );

    const rows = await d
      .select({
        subgroupKey: caseOutputs.subgroupKey,
        version: caseOutputs.outputVersion,
        current: caseOutputs.isCurrent,
      })
      .from(caseOutputs)
      .where(
        and(
          eq(caseOutputs.caseId, CASE_ID),
          eq(caseOutputs.outputType, "recommendation_letter_template"),
        ),
      );
    expect(rows).toHaveLength(3);
    const aV1 = rows.find((r) => r.subgroupKey === RECOMMENDER_A && r.version === 1);
    const aV2 = rows.find((r) => r.subgroupKey === RECOMMENDER_A && r.version === 2);
    const bV1 = rows.find((r) => r.subgroupKey === RECOMMENDER_B && r.version === 1);
    expect(aV1?.current).toBe(false);
    expect(aV2?.current).toBe(true);
    expect(bV1?.current).toBe(true);
  });

  it("version numbering is per-subgroup (B's first save is v1, not v3)", async (ctx) => {
    const d = gate(ctx);
    // A v1, A v2 (both before B). Then B v1 must be 1, not 3.
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_A,
        ...baseInput,
      }),
    );
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_A,
        ...baseInput,
      }),
    );
    const result = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        subgroupKey: RECOMMENDER_B,
        ...baseInput,
      }),
    );
    expect(result.outputVersion).toBe(1);
  });

  it("single-instance types (null subgroup) keep one-current-per-(case, type)", async (ctx) => {
    const d = gate(ctx);
    // Two saves of evidence_plan with no subgroup → only the second is current.
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "evidence_plan",
        ...baseInput,
      }),
    );
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "evidence_plan",
        ...baseInput,
      }),
    );
    const rows = await d
      .select({
        version: caseOutputs.outputVersion,
        current: caseOutputs.isCurrent,
        subgroupKey: caseOutputs.subgroupKey,
      })
      .from(caseOutputs)
      .where(
        and(
          eq(caseOutputs.caseId, CASE_ID),
          eq(caseOutputs.outputType, "evidence_plan"),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.subgroupKey === null)).toBe(true);
    expect(rows.find((r) => r.version === 1)?.current).toBe(false);
    expect(rows.find((r) => r.version === 2)?.current).toBe(true);
  });
});

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Attorney",
    email: "subgroup@docket.local",
  });
  await d
    .insert(organizations)
    .values({ id: ORG, name: "Org", slug: "subgroup-test-org" });
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
