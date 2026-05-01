// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
  clearOutputDraft,
  saveOutputDraft,
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
 * Stage 11 W3 — pending-draft buffer.
 *
 * Locks down the contract:
 *   - `saveOutputDraft` writes IN PLACE on the current row.
 *   - Refuses non-current and approved rows.
 *   - Idempotent (same content → no-op).
 *   - `clearOutputDraft` nulls the buffer.
 *   - `saveOutputVersion`'s prior-row flip clears the draft atomically
 *     (so committing a new version always lands on a clean draft slot).
 */

const ATTORNEY = "d4000000-0000-4000-8000-aaaa00000001";
const ORG = "d4000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d4000000-0000-4000-8000-cccc00000001";

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

/**
 * Convenience: create a baseline `case_outputs` row at v1 so each
 * draft test has something to write against. Uses `saveOutputVersion`
 * (the production write path) so we exercise the same code that ran
 * in the real Inngest job, not a hand-rolled INSERT.
 */
async function seedBaselineOutput(d: TestDb): Promise<{ outputId: string }> {
  const result = await d.transaction(async (tx) =>
    saveOutputVersion({
      tx: tx as never,
      caseId: CASE_ID,
      outputType: "personal_statement",
      content: "Baseline content.",
      computerSessionId: "mock-1",
      computeDurationMs: 100,
      promptTokens: 50,
      completionTokens: 100,
      usdCents: 5,
    }),
  );
  return { outputId: result.outputId };
}

describe("saveOutputDraft", () => {
  it("writes draft_content in place and leaves content unchanged", async (ctx) => {
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);

    const r = await d.transaction(async (tx) =>
      saveOutputDraft({
        tx: tx as never,
        outputId,
        content: "in-progress edit",
      }),
    );
    expect(r.saved).toBe(true);

    const [row] = await d
      .select({
        content: caseOutputs.content,
        draftContent: caseOutputs.draftContent,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, outputId));
    expect(row?.content).toBe("Baseline content.");
    expect(row?.draftContent).toBe("in-progress edit");
  });

  it("is idempotent — same content returns saved=false and skips the UPDATE", async (ctx) => {
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);

    await d.transaction(async (tx) =>
      saveOutputDraft({ tx: tx as never, outputId, content: "draft v1" }),
    );
    // Second call with identical content should short-circuit.
    const r = await d.transaction(async (tx) =>
      saveOutputDraft({ tx: tx as never, outputId, content: "draft v1" }),
    );
    expect(r.saved).toBe(false);
  });

  it("permits empty-string drafts (NULL ≠ '')", async (ctx) => {
    // The commit path rejects empty content, but a draft of `""` is a
    // valid in-progress state (user did Ctrl-A + Delete and is about
    // to type fresh prose).
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);

    const r = await d.transaction(async (tx) =>
      saveOutputDraft({ tx: tx as never, outputId, content: "" }),
    );
    expect(r.saved).toBe(true);

    const [row] = await d
      .select({ draftContent: caseOutputs.draftContent })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, outputId));
    expect(row?.draftContent).toBe("");
  });

  it("throws NOT_FOUND on a missing output", async (ctx) => {
    const d = gate(ctx);
    await expect(
      d.transaction(async (tx) =>
        saveOutputDraft({
          tx: tx as never,
          outputId: "00000000-0000-4000-8000-000000000000",
          content: "x",
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("throws NOT_FOUND on a soft-deleted row", async (ctx) => {
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);
    await d
      .update(caseOutputs)
      .set({ deletedAt: new Date() })
      .where(eq(caseOutputs.id, outputId));

    await expect(
      d.transaction(async (tx) =>
        saveOutputDraft({ tx: tx as never, outputId, content: "x" }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects writes against a non-current version", async (ctx) => {
    const d = gate(ctx);
    const { outputId: v1Id } = await seedBaselineOutput(d);
    // Create a v2 — flips v1 off via `saveOutputVersion`'s step 4.
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "personal_statement",
        content: "v2 content",
        computerSessionId: "mock-2",
        computeDurationMs: 100,
        promptTokens: 50,
        completionTokens: 100,
        usdCents: 5,
      }),
    );

    // v1 is now historical; saveDraft against it must refuse.
    await expect(
      d.transaction(async (tx) =>
        saveOutputDraft({ tx: tx as never, outputId: v1Id, content: "x" }),
      ),
    ).rejects.toThrow(/non-current/i);
  });

  it("rejects writes when the row is approved", async (ctx) => {
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);
    await d
      .update(caseOutputs)
      .set({ attorneyApproved: true, approvedBy: ATTORNEY, approvedAt: new Date() })
      .where(eq(caseOutputs.id, outputId));

    await expect(
      d.transaction(async (tx) =>
        saveOutputDraft({ tx: tx as never, outputId, content: "x" }),
      ),
    ).rejects.toThrow(/approved/i);
  });
});

describe("clearOutputDraft", () => {
  it("nulls a populated draft and reports cleared=true", async (ctx) => {
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);
    await d.transaction(async (tx) =>
      saveOutputDraft({ tx: tx as never, outputId, content: "to clear" }),
    );

    const r = await d.transaction(async (tx) =>
      clearOutputDraft({ tx: tx as never, outputId }),
    );
    expect(r.cleared).toBe(true);

    const [row] = await d
      .select({ draftContent: caseOutputs.draftContent })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, outputId));
    expect(row?.draftContent).toBeNull();
  });

  it("is idempotent on an already-clear draft", async (ctx) => {
    const d = gate(ctx);
    const { outputId } = await seedBaselineOutput(d);
    const r = await d.transaction(async (tx) =>
      clearOutputDraft({ tx: tx as never, outputId }),
    );
    expect(r.cleared).toBe(false);
  });
});

describe("saveOutputVersion clears prior draft on commit", () => {
  // Regression guard for the W3.4 invariant: once an attorney commits
  // a new version, the prior row's draft buffer MUST be cleared in the
  // same UPDATE so no phantom draft survives the version flip.
  it("nulls draft_content on the previous-current row when a new version commits", async (ctx) => {
    const d = gate(ctx);
    const { outputId: v1Id } = await seedBaselineOutput(d);
    await d.transaction(async (tx) =>
      saveOutputDraft({
        tx: tx as never,
        outputId: v1Id,
        content: "draft on v1 — about to be eclipsed by a v2 commit",
      }),
    );

    // Sanity: draft persisted before the version commit.
    const [pre] = await d
      .select({ draftContent: caseOutputs.draftContent })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, v1Id));
    expect(pre?.draftContent).toMatch(/about to be eclipsed/);

    // Commit v2 (regenerate / attorney save / restore — all funnel
    // through saveOutputVersion).
    await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "personal_statement",
        content: "v2 final content",
        computerSessionId: "mock-2",
        computeDurationMs: 100,
        promptTokens: 50,
        completionTokens: 100,
        usdCents: 5,
      }),
    );

    const [postV1] = await d
      .select({
        isCurrent: caseOutputs.isCurrent,
        draftContent: caseOutputs.draftContent,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, v1Id));
    expect(postV1?.isCurrent).toBe(false);
    expect(postV1?.draftContent).toBeNull();
  });

  it("the new version starts with draft_content NULL", async (ctx) => {
    const d = gate(ctx);
    await seedBaselineOutput(d);
    const r = await d.transaction(async (tx) =>
      saveOutputVersion({
        tx: tx as never,
        caseId: CASE_ID,
        outputType: "personal_statement",
        content: "v2",
        computerSessionId: "mock-2",
        computeDurationMs: 100,
        promptTokens: 50,
        completionTokens: 100,
        usdCents: 5,
      }),
    );
    const [row] = await d
      .select({ draftContent: caseOutputs.draftContent })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, r.outputId));
    expect(row?.draftContent).toBeNull();
  });
});

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values({
    id: ATTORNEY,
    name: "Attorney",
    email: "att@docket.local",
  });
  await d.insert(organizations).values({
    id: ORG,
    name: "Org",
    slug: "output-draft-test-org",
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
    status: "ready_to_build",
    // Generous budget so the draft tests don't trip the spend guard.
    computeBudgetCents: 10_000n,
  });
}
