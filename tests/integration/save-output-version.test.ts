// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  caseComputeLedger,
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
  getCaseSpendCents,
  getCurrentOutputs,
  getOutputVersionHistory,
  saveOutputVersion,
} from "@/server/services/output";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * `saveOutputVersion` is the single mutation path for `case_outputs`.
 * Tests cover: version-flip atomicity, ledger entries, spend bump,
 * partial-unique safety net, budget rejection.
 *
 * `tx as never` cast: `d.transaction(...)` yields a Drizzle tx whose
 * type is structurally compatible with `Db` but lacks the `$client`
 * brand the production `Db` type carries; `as never` lets the function
 * accept it without polluting the production signature.
 */

const ATTORNEY = "d0000000-0000-4000-8000-aaaa00000001";
const ORG = "d0000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d1000000-0000-4000-8000-aaaa00000001";

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

describe("saveOutputVersion", () => {
  it("creates version 1 with is_current=true and writes a ledger row", async (ctx) => {
    const d = gate(ctx);
    const result = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "evidence_plan",
        content: "v1 content",
        computerSessionId: "mock-1",
        computeDurationMs: 200,
        promptTokens: 100,
        completionTokens: 200,
        usdCents: 50,
      }),
    );

    expect(result.outputVersion).toBe(1);
    expect(result.newSpendCents).toBe(50n);

    const [row] = await d
      .select()
      .from(caseOutputs)
      .where(eq(caseOutputs.id, result.outputId));
    expect(row?.isCurrent).toBe(true);
    expect(row?.outputVersion).toBe(1);
    expect(row?.author).toBe("computer");

    const ledger = await d
      .select()
      .from(caseComputeLedger)
      .where(eq(caseComputeLedger.caseId, CASE_ID));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.amountCents).toBe(50n);
    expect(ledger[0]?.entryType).toBe("compute_spend");

    const [caseRow] = await d
      .select({ spent: cases.computeSpentCents })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(caseRow?.spent).toBe(50n);
  });

  it("flips prior version to is_current=false on regenerate", async (ctx) => {
    const d = gate(ctx);
    const v1 = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "petition_letter",
        content: "v1",
        computerSessionId: "mock-x",
        computeDurationMs: 100,
        promptTokens: 100,
        completionTokens: 100,
        usdCents: 30,
      }),
    );
    const v2 = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "petition_letter",
        content: "v2",
        computerSessionId: "mock-x",
        computeDurationMs: 100,
        promptTokens: 100,
        completionTokens: 100,
        usdCents: 30,
      }),
    );
    expect(v1.outputVersion).toBe(1);
    expect(v2.outputVersion).toBe(2);

    const [rowV1] = await d.select().from(caseOutputs).where(eq(caseOutputs.id, v1.outputId));
    const [rowV2] = await d.select().from(caseOutputs).where(eq(caseOutputs.id, v2.outputId));
    expect(rowV1?.isCurrent).toBe(false);
    expect(rowV2?.isCurrent).toBe(true);

    const [caseRow] = await d.select({ spent: cases.computeSpentCents }).from(cases).where(eq(cases.id, CASE_ID));
    expect(caseRow?.spent).toBe(60n);
  });

  it("rejects when projected spend exceeds budget (single oversize call)", async (ctx) => {
    const d = gate(ctx);
    await expect(
      d.transaction(async (tx) =>
        saveOutputVersion({
          tx: tx as never,
          caseId: CASE_ID,
          outputType: "evidence_plan",
          content: "should not save",
          computerSessionId: "mock-budget",
          computeDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          usdCents: 5001,
        }),
      ),
    ).rejects.toThrow(/compute budget exceeded/i);

    const rows = await d.select().from(caseOutputs).where(eq(caseOutputs.caseId, CASE_ID));
    expect(rows).toHaveLength(0);
    const ledger = await d.select().from(caseComputeLedger).where(eq(caseComputeLedger.caseId, CASE_ID));
    expect(ledger).toHaveLength(0);
  });

  it("rejects when accumulated spend would exceed budget (multi-call)", async (ctx) => {
    const d = gate(ctx);
    // Budget = 5000 cents. Spend 5 × 999 = 4995 cents (4 successful
    // versions of evidence_plan, then a 5th of personal_statement).
    // The 6th call adding 10 cents pushes to 5005 → must reject.
    const types = [
      "evidence_plan",
      "personal_statement",
      "petition_letter",
      "exhibit_index",
      "criteria_analysis",
    ] as const;
    for (const t of types) {
      await d.transaction(async (tx) =>
        saveOutputVersion({
          tx: tx as never,
          caseId: CASE_ID,
          outputType: t,
          content: `${t} v1`,
          computerSessionId: "s",
          computeDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          usdCents: 999,
        }),
      );
    }

    // Spent 5 × 999 = 4995. One more 10-cent call → projected 5005, over.
    await expect(
      d.transaction(async (tx) =>
        saveOutputVersion({
          tx: tx as never,
          caseId: CASE_ID,
          outputType: "evidence_plan",
          content: "should not save",
          computerSessionId: "s",
          computeDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          usdCents: 10,
        }),
      ),
    ).rejects.toThrow(/compute budget exceeded/i);

    const [caseRow] = await d
      .select({ spent: cases.computeSpentCents })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(caseRow?.spent).toBe(4995n); // unchanged after rejected attempt
  });

  it("throws on negative usdCents (caller bug)", async (ctx) => {
    const d = gate(ctx);
    await expect(
      d.transaction(async (tx) =>
        saveOutputVersion({
          tx: tx as never,
          caseId: CASE_ID,
          outputType: "evidence_plan",
          content: "x",
          computerSessionId: "s",
          computeDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          usdCents: -5,
        }),
      ),
    ).rejects.toThrow(/non-negative finite/i);
  });

  it("stamps metadata with the output_type discriminator and persists it", async (ctx) => {
    // OutputMetadataSchema is `z.union([...])` with a permissive
    // GenericMetadata branch (`passthrough`), so most shapes survive
    // validation. The contract this test pins: every metadata blob
    // gets a `type` field auto-stamped to the outputType so future
    // `z.discriminatedUnion`-style readers know which branch to pick.
    const d = gate(ctx);
    const result = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        content: "x",
        computerSessionId: "s",
        computeDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        usdCents: 1,
        metadata: { recommenderName: "Prof. Jane Smith" },
      }),
    );
    const [row] = await d
      .select({ metadata: caseOutputs.metadata })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, result.outputId));
    expect(row?.metadata).toMatchObject({
      type: "recommendation_letter_template",
      recommenderName: "Prof. Jane Smith",
    });
  });

  it("rejects when case is missing or soft-deleted", async (ctx) => {
    const d = gate(ctx);
    await d.update(cases).set({ deletedAt: new Date() }).where(eq(cases.id, CASE_ID));

    await expect(
      d.transaction(async (tx) =>
        saveOutputVersion({
          tx: tx as never,
          caseId: CASE_ID,
          outputType: "evidence_plan",
          content: "x",
          computerSessionId: "mock-deleted",
          computeDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          usdCents: 10,
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("isolates output_type — same case, two types, both versioned independently", async (ctx) => {
    const d = gate(ctx);
    const ep = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "evidence_plan",
        content: "ep1",
        computerSessionId: "mock-ep",
        computeDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        usdCents: 10,
      }),
    );
    const pl = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "petition_letter",
        content: "pl1",
        computerSessionId: "mock-pl",
        computeDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        usdCents: 10,
      }),
    );
    expect(ep.outputVersion).toBe(1);
    expect(pl.outputVersion).toBe(1);
  });
});

describe("getCurrentOutputs", () => {
  it("returns only is_current=true rows, ordered alphabetically by output_type", async (ctx) => {
    const d = gate(ctx);
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "petition_letter",
        content: "pl",
        computerSessionId: "s",
        computeDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        usdCents: 1,
      }),
    );
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "evidence_plan",
        content: "ep",
        computerSessionId: "s",
        computeDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        usdCents: 1,
      }),
    );
    // Regenerate evidence_plan → v2.
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "evidence_plan",
        content: "ep2",
        computerSessionId: "s",
        computeDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        usdCents: 1,
      }),
    );

    const out = await getCurrentOutputs({ db: d as never, caseId: CASE_ID });
    expect(out.map((r) => r.outputType)).toEqual(["evidence_plan", "petition_letter"]);
    const ep = out.find((r) => r.outputType === "evidence_plan");
    expect(ep?.outputVersion).toBe(2);
    expect(ep?.content).toBe("ep2");
  });
});

describe("getOutputVersionHistory", () => {
  it("returns all versions newest-first", async (ctx) => {
    const d = gate(ctx);
    for (let i = 0; i < 3; i++) {
      await d.transaction(async (tx) =>
        saveOutputVersion({
          tx: tx as never,
          caseId: CASE_ID,
          outputType: "exhibit_index",
          content: `v${i + 1}`,
          computerSessionId: "s",
          computeDurationMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          usdCents: 1,
        }),
      );
    }
    const history = await getOutputVersionHistory({
      db: d as never,
      caseId: CASE_ID,
      outputType: "exhibit_index",
    });
    expect(history.map((h) => h.outputVersion)).toEqual([3, 2, 1]);
    expect(history[0]?.isCurrent).toBe(true);
    expect(history[1]?.isCurrent).toBe(false);
    expect(history[2]?.isCurrent).toBe(false);
  });
});

describe("getCaseSpendCents", () => {
  it("returns spent + budget for an existing case", async (ctx) => {
    const d = gate(ctx);
    const out = await getCaseSpendCents({ db: d as never, caseId: CASE_ID });
    expect(out?.spentCents).toBe(0n);
    expect(out?.budgetCents).toBe(5000n);
  });

  it("returns null for missing case", async (ctx) => {
    const d = gate(ctx);
    const out = await getCaseSpendCents({
      db: d as never,
      caseId: "00000000-0000-4000-8000-000000000000",
    });
    expect(out).toBeNull();
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
    .values({ id: ORG, name: "Org", slug: "save-output-version-test-org" });
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
