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
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { truncateAllAppTables } from "../helpers/truncate";

/**
 * `runOutputJob` integration: drives the helper end-to-end against the
 * real `MockComputerClient` (factory routes there when PERPLEXITY_API_KEY
 * is unset, which is the case in the test env) and a real Postgres
 * transaction. Verifies the wire-up between generate → saveOutputVersion
 * — the unit test mocks both sides; this test catches the pieces in
 * between.
 *
 * What we lock down:
 *   - A new `case_outputs` row lands with version 1, is_current=true
 *   - A `case_compute_ledger` row is written with the same usdCents
 *   - `cases.compute_spent_cents` is bumped
 *   - The returned `newSpendCents` is a stringified bigint (Inngest-safe)
 *   - The result's `computerSessionId` matches the saved row's column
 */

const ATTORNEY = "d2000000-0000-4000-8000-aaaa00000001";
const ORG = "d2000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "d2000000-0000-4000-8000-cccc00000001";

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

describe("runOutputJob (integration, mock computer + real db)", () => {
  it("generates + saves a v1 row, ledger, and bumps spend", async (ctx) => {
    const d = gate(ctx);
    // Late dynamic import so the test-env env vars (NODE_ENV=test, no
    // PERPLEXITY_API_KEY) drive the factory toward MockComputerClient.
    const { runOutputJob } = await import("@/server/jobs/_shared");

    const r = await runOutputJob({
      caseId: CASE_ID,
      outputType: "evidence_plan",
      // `jsonSchema` is required for structured outputs: production
      // prompt builders always set it, and `MockComputerClient` keys
      // off its presence to return schema-conforming JSON. Without it,
      // the mock returns lorem prose and `validateStructuredOutput`
      // (rightly) rejects the result.
      prompt: {
        systemPrompt: "sys",
        userPrompt: "usr",
        jsonSchema: { name: "test", schema: { type: "object" } },
      },
      sessionId: "test-session",
    });

    expect(r.outputVersion).toBe(1);
    expect(r.outputId).toMatch(/^[0-9a-f-]{36}$/);
    // Stringified bigint — JSON.stringify(BigInt) would throw, so the
    // helper deliberately serializes here. Round-trip via BigInt() works.
    expect(typeof r.newSpendCents).toBe("string");
    expect(BigInt(r.newSpendCents)).toBeGreaterThan(0n);
    expect(r.costCents).toBeGreaterThan(0);
    expect(r.computerSessionId).toMatch(/^mock-/); // MockComputerClient prefix

    const [savedRow] = await d
      .select()
      .from(caseOutputs)
      .where(eq(caseOutputs.id, r.outputId));
    expect(savedRow?.outputVersion).toBe(1);
    expect(savedRow?.isCurrent).toBe(true);
    expect(savedRow?.outputType).toBe("evidence_plan");
    expect(savedRow?.computerSessionId).toBe(r.computerSessionId);
    expect(savedRow?.author).toBe("computer");
    expect(savedRow?.costCents).toBe(BigInt(r.costCents));

    const ledger = await d
      .select()
      .from(caseComputeLedger)
      .where(eq(caseComputeLedger.outputId, r.outputId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.entryType).toBe("compute_spend");
    expect(ledger[0]?.amountCents).toBe(BigInt(r.costCents));

    const [caseRow] = await d
      .select({ spent: cases.computeSpentCents })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(caseRow?.spent).toBe(BigInt(r.newSpendCents));
  });

  it("two consecutive calls produce v1 then v2 with v1 flipped to is_current=false", async (ctx) => {
    const d = gate(ctx);
    const { runOutputJob } = await import("@/server/jobs/_shared");

    // jsonSchema required so the mock returns schema-conforming JSON;
    // see the comment in the v1 test above for the rationale.
    const structuredPrompt = {
      systemPrompt: "s",
      userPrompt: "u",
      jsonSchema: { name: "test", schema: { type: "object" } },
    };
    const first = await runOutputJob({
      caseId: CASE_ID,
      outputType: "exhibit_index",
      prompt: structuredPrompt,
      sessionId: "s1",
      extraMetadata: { exhibitCount: 0 },
    });
    const second = await runOutputJob({
      caseId: CASE_ID,
      outputType: "exhibit_index",
      prompt: structuredPrompt,
      sessionId: "s2",
      extraMetadata: { exhibitCount: 0 },
    });

    expect(first.outputVersion).toBe(1);
    expect(second.outputVersion).toBe(2);

    const rows = await d
      .select({ v: caseOutputs.outputVersion, current: caseOutputs.isCurrent })
      .from(caseOutputs)
      .where(eq(caseOutputs.caseId, CASE_ID));
    const v1 = rows.find((r) => r.v === 1);
    const v2 = rows.find((r) => r.v === 2);
    expect(v1?.current).toBe(false);
    expect(v2?.current).toBe(true);
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
    .values({ id: ORG, name: "Org", slug: "jobs-runner-test-org" });
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
