// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseOutputs,
  caseParticipants,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

const sendMock = vi.hoisted(() =>
  vi.fn(async () => ({ ids: ["evt-test-id"] })),
);
vi.mock("@/server/jobs/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/jobs/client")>(
    "@/server/jobs/client",
  );
  return {
    ...actual,
    inngest: { ...actual.inngest, send: sendMock },
  };
});

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    limit: 20,
    remaining: 19,
    reset: 0,
  })),
);
vi.mock("@/server/services/ratelimit", () => ({ rateLimit: rateLimitMock }));

// Mock the heavy PDF render path so router tests don't pull in
// @react-pdf/renderer's startup cost. The renderToBuffer path itself
// is exercised in `pdf-render.test.tsx`.
vi.mock("@/server/services/pdf", () => ({
  renderPerOutputPdf: vi.fn(async () => ({
    url: "/api/files/per-output-stub",
    key: "k",
    bytes: 1234,
  })),
  compileFullPackagePdf: vi.fn(async (args: { caseId: string }) => {
    void args;
    return { url: "/api/files/package-stub", key: "k", bytes: 5678 };
  }),
}));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * Stage 08 output router — covers all 8 procedures end-to-end:
 *   list, get, listVersions, update, approve, unapprove, regenerate,
 *   restoreVersion, downloadPdf, downloadPackage.
 *
 * Mocks: `inngest.send`, `rateLimit`, and the `pdf` service. DB and
 * tRPC stack are real.
 */

const ATTORNEY = "f1000000-0000-4000-8000-aaaa00000001";
const STRANGER = "f1000000-0000-4000-8000-aaaa00000002";
const ORG = "f1000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f1000000-0000-4000-8000-cccc00000001";

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null) =>
  callerFactory({
    headers: new Headers(),
    user: userId ? { id: userId } : null,
  });

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
  if (!rlsReady) return;
  await teardown(db);
  await seed(db);
});

beforeEach(async () => {
  if (!db) return;
  // Reset the per-case output rows but keep the user/org/case shells.
  await db.execute(
    sql`delete from case_outputs where case_id = ${CASE_ID}` as never,
  );
  sendMock.mockClear();
  rateLimitMock.mockClear();
  rateLimitMock.mockResolvedValue({
    success: true,
    limit: 20,
    remaining: 19,
    reset: 0,
  });
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

async function insertOutput(
  d: TestDb,
  overrides: Partial<{
    outputType: string;
    content: string;
    attorneyApproved: boolean;
    subgroupKey: string | null;
  }> = {},
): Promise<string> {
  const [out] = await d
    .insert(caseOutputs)
    .values({
      caseId: CASE_ID,
      outputType:
        (overrides.outputType as
          | "evidence_plan"
          | "personal_statement"
          | "petition_letter"
          | "exhibit_index") ?? "personal_statement",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: overrides.content ?? "draft v1",
      attorneyApproved: overrides.attorneyApproved ?? false,
      ...(overrides.subgroupKey !== undefined
        ? { subgroupKey: overrides.subgroupKey }
        : {}),
    })
    .returning({ id: caseOutputs.id });
  if (!out) throw new Error("insert returned no id");
  return out.id;
}

describe("output.list / get / listVersions", () => {
  it("list returns current outputs for the caller's case", async (ctx) => {
    const d = gate(ctx);
    await insertOutput(d, { outputType: "personal_statement" });
    await insertOutput(d, { outputType: "petition_letter" });
    const r = await callAs(ATTORNEY).output.list({ caseId: CASE_ID });
    expect(r).toHaveLength(2);
    expect(r.map((o) => o.outputType).sort()).toEqual([
      "personal_statement",
      "petition_letter",
    ]);
  });

  it("list returns SLIM projection — no `content` or `contentHtml` over the wire", async (ctx) => {
    const d = gate(ctx);
    await insertOutput(d, { content: "this is a 50-byte body to verify" });
    const r = await callAs(ATTORNEY).output.list({ caseId: CASE_ID });
    expect(r).toHaveLength(1);
    const item = r[0]!;
    // Regression guard: drift back to the full projection would
    // re-introduce the bandwidth bug for grids of 9 outputs × 50KB.
    expect("content" in item).toBe(false);
    expect("contentHtml" in item).toBe(false);
    // The slim projection ships content size only.
    expect(item.contentLength).toBe(32);
    expect(item.hasContentHtml).toBe(false);
  });

  it("list returns empty for cases the caller can't see (RLS)", async (ctx) => {
    const d = gate(ctx);
    await insertOutput(d);
    const r = await callAs(STRANGER).output.list({ caseId: CASE_ID });
    expect(r).toEqual([]);
  });

  it("list groups recommendation_letter_template per subgroup (deterministic order)", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "letter B",
        subgroupKey: "rec-b",
      },
      {
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "letter A",
        subgroupKey: "rec-a",
      },
    ]);
    const r = await callAs(ATTORNEY).output.list({ caseId: CASE_ID });
    expect(r).toHaveLength(2);
    expect(r.map((o) => o.subgroupKey)).toEqual(["rec-a", "rec-b"]);
  });

  it("get returns the full row for an authorized caller", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    const r = await callAs(ATTORNEY).output.get({ outputId: id });
    expect(r.id).toBe(id);
    expect(r.content).toBe("draft v1");
  });

  it("get NOT_FOUND for cross-attorney access", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await expect(
      callAs(STRANGER).output.get({ outputId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("get NOT_FOUND for a non-existent outputId (no existence oracle)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).output.get({
        outputId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listVersions returns the chain newest-first", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        outputVersion: 1,
        isCurrent: false,
        author: "computer",
        content: "v1",
      },
      {
        caseId: CASE_ID,
        outputType: "evidence_plan",
        outputVersion: 2,
        isCurrent: true,
        author: "computer",
        content: "v2",
      },
    ]);
    const r = await callAs(ATTORNEY).output.listVersions({
      caseId: CASE_ID,
      outputType: "evidence_plan",
    });
    expect(r.map((v) => v.outputVersion)).toEqual([2, 1]);
  });

  it("listVersions filters by subgroupKey when provided", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "A v1",
        subgroupKey: "rec-a",
      },
      {
        caseId: CASE_ID,
        outputType: "recommendation_letter_template",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "B v1",
        subgroupKey: "rec-b",
      },
    ]);
    const r = await callAs(ATTORNEY).output.listVersions({
      caseId: CASE_ID,
      outputType: "recommendation_letter_template",
      subgroupKey: "rec-a",
    });
    expect(r).toHaveLength(1);
  });
});

describe("output.update", () => {
  it("creates a new version with author=attorney + parentId", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    const r = await callAs(ATTORNEY).output.update({
      outputId: id,
      content: "## Edited\n\nNew prose body.",
    });
    expect(r.outputVersion).toBe(2);
    expect(r.outputId).not.toBe(id);

    const [v2] = await d
      .select({
        author: caseOutputs.author,
        parentId: caseOutputs.parentId,
        contentHtml: caseOutputs.contentHtml,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, r.outputId));
    expect(v2?.author).toBe("attorney");
    expect(v2?.parentId).toBe(id);
    // Pre-rendered HTML cache (sanitized).
    expect(v2?.contentHtml).toContain("<h2>Edited</h2>");
  });

  it("CONFLICT when parent is approved (must un-approve first)", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d, { attorneyApproved: true });
    await expect(
      callAs(ATTORNEY).output.update({ outputId: id, content: "new" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("BAD_REQUEST on whitespace-only content", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    // The `min(1)` in zod catches truly empty; whitespace passes the
    // length check but the service's trim-check rejects.
    await expect(
      callAs(ATTORNEY).output.update({ outputId: id, content: "   \n   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sanitizes malicious paste (script/iframe/javascript:) in cached contentHtml", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    const r = await callAs(ATTORNEY).output.update({
      outputId: id,
      content:
        "Hello.\n\n<script>alert(1)</script>\n\nClick [here](javascript:alert(1)) or [safe](https://uscis.gov).\n\n<iframe src=\"evil\"></iframe>",
    });
    const [v2] = await d
      .select({
        content: caseOutputs.content,
        contentHtml: caseOutputs.contentHtml,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, r.outputId));
    // The MARKDOWN source is stored verbatim — that's our canonical form.
    // Round-trip through the editor would re-sanitize, but for now the
    // raw markdown carries the source.
    expect(v2?.content).toContain("<script>");
    // The CACHED HTML must NOT contain executable surfaces. This is
    // what gets rendered to the browser + the PDF.
    expect(v2?.contentHtml ?? "").not.toContain("<script");
    expect(v2?.contentHtml ?? "").not.toContain("<iframe");
    expect(v2?.contentHtml ?? "").not.toContain("javascript:");
    // Safe link survives.
    expect(v2?.contentHtml ?? "").toContain('href="https://uscis.gov"');
  });

  it("VALIDATION error when content exceeds 200_000 char cap", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await expect(
      callAs(ATTORNEY).output.update({
        outputId: id,
        content: "x".repeat(200_001),
      }),
    ).rejects.toThrow();
  });

  it("update NOT_FOUND when outputId doesn't exist", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).output.update({
        outputId: "00000000-0000-4000-8000-000000000000",
        content: "x",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BAD_REQUEST when called on a structured-output type (exhibit_index)", async (ctx) => {
    // Structured types must go through `updateStructured` so the JSON
    // contract that downstream `_context.ts` parsers depend on is
    // preserved. A stale client that POSTs markdown to `update` would
    // otherwise corrupt the row.
    const d = gate(ctx);
    const id = await insertOutput(d, {
      outputType: "exhibit_index",
      content: JSON.stringify({ entries: [] }),
    });
    await expect(
      callAs(ATTORNEY).output.update({
        outputId: id,
        content: "## Some markdown",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("output.updateStructured (commit C)", () => {
  const VALID_PAYLOAD = {
    entries: [
      {
        label: "Exhibit A",
        documentId: "doc-1",
        filename: "cv.pdf",
        description: "Curriculum vitae.",
        supportsCriteria: ["authorship_of_scholarly_articles"],
      },
    ],
  };

  it("creates a new version with JSON-stringified payload", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d, {
      outputType: "exhibit_index",
      content: JSON.stringify({ entries: [] }),
    });
    const r = await callAs(ATTORNEY).output.updateStructured({
      outputType: "exhibit_index",
      outputId: id,
      payload: VALID_PAYLOAD,
    });
    expect(r.outputVersion).toBe(2);
    expect(r.outputId).not.toBe(id);

    const [v2] = await d
      .select({
        author: caseOutputs.author,
        parentId: caseOutputs.parentId,
        content: caseOutputs.content,
        contentHtml: caseOutputs.contentHtml,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, r.outputId));
    expect(v2?.author).toBe("attorney");
    expect(v2?.parentId).toBe(id);
    // Canonical content is JSON-stringified — round-trip cleanly.
    expect(JSON.parse(v2?.content ?? "null")).toEqual(VALID_PAYLOAD);
    // Structured types intentionally don't store an HTML cache —
    // their render path goes through the JSON→markdown formatter
    // at read time.
    expect(v2?.contentHtml).toBeNull();
  });

  it("BAD_REQUEST when outputType discriminator does not match the row's actual type", async (ctx) => {
    // Defense in depth — without this check, an attacker crafting an
    // `exhibit_index` payload but pointing at a `personal_statement`
    // row's outputId would corrupt that row with stringified JSON.
    const d = gate(ctx);
    const proseId = await insertOutput(d, {
      outputType: "personal_statement",
      content: "real prose",
    });
    await expect(
      callAs(ATTORNEY).output.updateStructured({
        outputType: "exhibit_index",
        outputId: proseId,
        payload: VALID_PAYLOAD,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("VALIDATION rejects payload missing required fields (Zod schema enforced server-side)", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d, {
      outputType: "exhibit_index",
      content: JSON.stringify({ entries: [] }),
    });
    await expect(
      callAs(ATTORNEY).output.updateStructured({
        outputType: "exhibit_index",
        outputId: id,
        // @ts-expect-error — missing required `entries` (intentional bad input)
        payload: { not: "valid" },
      }),
    ).rejects.toThrow();
  });

  it("CONFLICT when parent row is already approved (must un-approve first)", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d, {
      outputType: "exhibit_index",
      content: JSON.stringify({ entries: [] }),
      attorneyApproved: true,
    });
    await expect(
      callAs(ATTORNEY).output.updateStructured({
        outputType: "exhibit_index",
        outputId: id,
        payload: VALID_PAYLOAD,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("output.approve / unapprove (idempotency + branches)", () => {
  it("approve flips attorneyApproved + stamps approvedBy/approvedAt", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await callAs(ATTORNEY).output.approve({ outputId: id, notes: "LGTM" });
    const [row] = await d
      .select({
        approved: caseOutputs.attorneyApproved,
        by: caseOutputs.approvedBy,
        at: caseOutputs.approvedAt,
        notes: caseOutputs.approvalNotes,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, id));
    expect(row?.approved).toBe(true);
    expect(row?.by).toBe(ATTORNEY);
    expect(row?.at).not.toBeNull();
    expect(row?.notes).toBe("LGTM");
  });

  it("unapprove flips back + clears approval fields", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d, { attorneyApproved: true });
    // Stamp some approval state to verify it's cleared.
    await d
      .update(caseOutputs)
      .set({ approvedAt: new Date(), approvedBy: ATTORNEY, approvalNotes: "x" })
      .where(eq(caseOutputs.id, id));
    await callAs(ATTORNEY).output.unapprove({ outputId: id });
    const [row] = await d
      .select({
        approved: caseOutputs.attorneyApproved,
        by: caseOutputs.approvedBy,
        at: caseOutputs.approvedAt,
        notes: caseOutputs.approvalNotes,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, id));
    expect(row?.approved).toBe(false);
    expect(row?.by).toBeNull();
    expect(row?.at).toBeNull();
    expect(row?.notes).toBeNull();
  });

  it("approve is idempotent — second call on already-approved is a no-op", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await callAs(ATTORNEY).output.approve({ outputId: id });
    const [first] = await d
      .select({ approvedAt: caseOutputs.approvedAt })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, id));
    // Second call returns ok but doesn't change approvedAt (service
    // returns `changed: false` and skips the UPDATE).
    await callAs(ATTORNEY).output.approve({ outputId: id });
    const [second] = await d
      .select({ approvedAt: caseOutputs.approvedAt })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, id));
    expect(second?.approvedAt?.getTime()).toBe(first?.approvedAt?.getTime());
  });

  it("unapprove is idempotent on already-unapproved", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    // Already unapproved (default false). Should not throw.
    await callAs(ATTORNEY).output.unapprove({ outputId: id });
    const [row] = await d
      .select({ approved: caseOutputs.attorneyApproved })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, id));
    expect(row?.approved).toBe(false);
  });

  it("approve NOT_FOUND when outputId doesn't exist", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).output.approve({
        outputId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("output.regenerate", () => {
  it("auto-unapproves THEN emits regenerate event", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d, { attorneyApproved: true });
    await callAs(ATTORNEY).output.regenerate({
      outputId: id,
      guidance: "more citations",
    });
    const [row] = await d
      .select({ approved: caseOutputs.attorneyApproved })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, id));
    expect(row?.approved).toBe(false);

    expect(sendMock).toHaveBeenCalledWith({
      name: "case/output.regenerate.requested",
      data: {
        caseId: CASE_ID,
        outputId: id,
        guidance: "more citations",
      },
    });
  });

  it("TOO_MANY_REQUESTS when rate-limited", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    rateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 20,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    await expect(
      callAs(ATTORNEY).output.regenerate({ outputId: id }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("regenerate WITHOUT guidance omits the guidance field from the event payload", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await callAs(ATTORNEY).output.regenerate({ outputId: id });
    expect(sendMock).toHaveBeenCalledWith({
      name: "case/output.regenerate.requested",
      data: { caseId: CASE_ID, outputId: id },
    });
  });

  it("regenerate NOT_FOUND for non-existent output — no event emitted, no DB mutation", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).output.regenerate({
        outputId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sendMock).not.toHaveBeenCalled();
    // Rate-limit IS consumed before the access gate (industry-standard
    // ordering — prevents output-id probing from bypassing the cap).
    // Asserting the call ensures the order doesn't accidentally flip
    // (which would let unauth callers spam access checks).
    expect(rateLimitMock).toHaveBeenCalledWith("output.regenerate", ATTORNEY);
  });
});

describe("output.restoreVersion", () => {
  it("copies prior version content into a fresh is_current row", async (ctx) => {
    const d = gate(ctx);
    const v1Id = await insertOutput(d, { content: "first version" });
    // Save a v2 via update, then restore v1.
    const v2 = await callAs(ATTORNEY).output.update({
      outputId: v1Id,
      content: "second version",
    });
    expect(v2.outputVersion).toBe(2);
    const restored = await callAs(ATTORNEY).output.restoreVersion({
      fromVersionId: v1Id,
    });
    expect(restored.outputVersion).toBe(3);

    const [row] = await d
      .select({
        content: caseOutputs.content,
        author: caseOutputs.author,
        parentId: caseOutputs.parentId,
        current: caseOutputs.isCurrent,
      })
      .from(caseOutputs)
      .where(eq(caseOutputs.id, restored.outputId));
    expect(row?.content).toBe("first version");
    expect(row?.author).toBe("system");
    expect(row?.parentId).toBe(v1Id);
    expect(row?.current).toBe(true);
  });

  it("restoreVersion NOT_FOUND when fromVersionId doesn't exist", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).output.restoreVersion({
        fromVersionId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restoreVersion NOT_FOUND for cross-attorney access (RLS)", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await expect(
      callAs(STRANGER).output.restoreVersion({ fromVersionId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("output.downloadPdf / downloadPackage", () => {
  it("downloadPdf returns a signed URL via the PDF service", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    const r = await callAs(ATTORNEY).output.downloadPdf({ outputId: id });
    expect(r.url).toBe("/api/files/per-output-stub");
  });

  it("downloadPackage returns a signed URL via the PDF service", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).output.downloadPackage({
      caseId: CASE_ID,
    });
    expect(r.url).toBe("/api/files/package-stub");
  });
});

describe("output.summarize", () => {
  it("returns approved/total tallies keyed by caseId", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "x",
        attorneyApproved: true,
      },
      {
        caseId: CASE_ID,
        outputType: "petition_letter",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "y",
        attorneyApproved: false,
      },
    ]);
    const r = await callAs(ATTORNEY).output.summarize({
      caseIds: [CASE_ID],
    });
    expect(r[CASE_ID]).toEqual({ approved: 1, total: 2 });
  });

  it("returns empty object when caseIds is empty (no DB hit)", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).output.summarize({ caseIds: [] });
    expect(r).toEqual({});
  });

  it("omits caseIds with zero current outputs (UI renders dash)", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).output.summarize({ caseIds: [CASE_ID] });
    expect(r[CASE_ID]).toBeUndefined();
  });

  it("excludes outputs the caller can't see (RLS — no entry in result)", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "personal_statement",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: "x",
      attorneyApproved: true,
    });
    const r = await callAs(STRANGER).output.summarize({ caseIds: [CASE_ID] });
    expect(r[CASE_ID]).toBeUndefined();
  });

  it("excludes soft-deleted + non-current rows from the tally", async (ctx) => {
    const d = gate(ctx);
    await d.insert(caseOutputs).values([
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: false, // not current → excluded
        author: "computer",
        content: "v1",
        attorneyApproved: true,
      },
      {
        caseId: CASE_ID,
        outputType: "personal_statement",
        outputVersion: 2,
        isCurrent: true,
        author: "computer",
        content: "v2",
        attorneyApproved: true,
      },
      {
        caseId: CASE_ID,
        outputType: "petition_letter",
        outputVersion: 1,
        isCurrent: true,
        author: "computer",
        content: "deleted",
        attorneyApproved: true,
        deletedAt: new Date(), // soft-deleted → excluded
      },
    ]);
    const r = await callAs(ATTORNEY).output.summarize({ caseIds: [CASE_ID] });
    expect(r[CASE_ID]).toEqual({ approved: 1, total: 1 });
  });

  it("validation: rejects more than 200 caseIds", async (ctx) => {
    gate(ctx);
    const ids = Array.from({ length: 201 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    await expect(
      callAs(ATTORNEY).output.summarize({ caseIds: ids }),
    ).rejects.toThrow();
  });
});

describe("UNAUTHORIZED + FORBIDDEN gates", () => {
  it("UNAUTHORIZED for unauthenticated update", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    await expect(
      callAs(null).output.update({ outputId: id, content: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("UNAUTHORIZED for unauthenticated approve / unapprove / regenerate / restoreVersion / downloadPdf / downloadPackage", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    const o = callAs(null).output;
    await expect(o.approve({ outputId: id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(o.unapprove({ outputId: id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(o.regenerate({ outputId: id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      o.restoreVersion({ fromVersionId: id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(o.downloadPdf({ outputId: id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      o.downloadPackage({ caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("UNAUTHORIZED for unauthenticated reads (list / get / listVersions)", async (ctx) => {
    const d = gate(ctx);
    const id = await insertOutput(d);
    const o = callAs(null).output;
    await expect(o.list({ caseId: CASE_ID })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(o.get({ outputId: id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      o.listVersions({ caseId: CASE_ID, outputType: "personal_statement" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ATTORNEY, name: "Test Attorney", email: "out-att@docket.local" },
    { id: STRANGER, name: "Stranger", email: "out-str@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: STRANGER, role: "attorney" },
  ]);
  await d.insert(organizations).values({
    id: ORG,
    name: "Org",
    slug: "output-router-test-org",
  });
  await d.insert(organizationMembers).values({
    organizationId: ORG,
    userId: ATTORNEY,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await d.insert(attorneyProfiles).values([
    { userId: ATTORNEY, status: "active" },
    { userId: STRANGER, status: "active" },
  ]);
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

async function teardown(d: TestDb): Promise<void> {
  await d.execute(
    /* sql */ `delete from case_outputs where case_id = '${CASE_ID}'` as never,
  );
  await d.execute(
    /* sql */ `delete from cases where id = '${CASE_ID}'` as never,
  );
  await d.execute(
    /* sql */ `delete from attorney_profiles where user_id in ('${ATTORNEY}', '${STRANGER}')` as never,
  );
  await d.execute(
    /* sql */ `delete from organization_members where organization_id = '${ORG}'` as never,
  );
  await d.execute(
    /* sql */ `delete from organizations where id = '${ORG}'` as never,
  );
  await d.execute(
    /* sql */ `delete from user_roles where user_id in ('${ATTORNEY}', '${STRANGER}')` as never,
  );
  await d.execute(
    /* sql */ `delete from users where id in ('${ATTORNEY}', '${STRANGER}')` as never,
  );
}
