// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  caseDocuments,
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

const rateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: 0 })),
);
vi.mock("@/server/services/ratelimit", () => ({ rateLimit: rateLimitMock }));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";
import { PER_CASE_STORAGE_BYTES } from "@/lib/visa-criteria";

/**
 * Stage 11 β + γ — coverage / preflight / storage / setPackageOrder.
 *
 * Each test exercises the real tRPC stack against the real test DB so
 * RLS, the `app_user` role, and the procedure middlewares all engage.
 * The test seeds ONE attorney + ONE active profile + ONE case at the
 * top, then `beforeEach` clears per-case rows the tests mutate
 * (documents, outputs, package_order). The shells stay so we don't
 * pay the seed cost on every test.
 */

const ATTORNEY = "f2000000-0000-4000-8000-aaaa00000001";
const STRANGER = "f2000000-0000-4000-8000-aaaa00000002";
const ORG = "f2000000-0000-4000-8000-bbbb00000001";
const CASE_ID = "f2000000-0000-4000-8000-cccc00000001";

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
  // Clear per-test rows; keep the user / org / case shells.
  await db.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await db.execute(sql`delete from case_documents where case_id = ${CASE_ID}`);
  await db
    .update(cases)
    .set({ packageOrder: null })
    .where(eq(cases.id, CASE_ID));
  rateLimitMock.mockClear();
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

// ─────────────────────────────────────────────────────────────────────
// criteriaCoverage
// ─────────────────────────────────────────────────────────────────────

describe("case.criteriaCoverage", () => {
  it("returns all O-1A criteria with strength=none on an empty case", async (ctx) => {
    gate(ctx);
    const result = await callAs(ATTORNEY).case.criteriaCoverage({
      caseId: CASE_ID,
    });
    expect(result.visaSupported).toBe(true);
    expect(result.rows).toHaveLength(8);
    expect(result.rows.every((r) => r.strength === "none")).toBe(true);
    expect(result.metCount).toBe(0);
  });

  it("attributes one publication to BOTH criterion 4 and 6", async (ctx) => {
    const d = gate(ctx);
    await insertDoc(d, { documentType: "publication" });
    const result = await callAs(ATTORNEY).case.criteriaCoverage({
      caseId: CASE_ID,
    });
    expect(rowFor(result.rows, 4)?.exhibitCount).toBe(1);
    expect(rowFor(result.rows, 6)?.exhibitCount).toBe(1);
    expect(result.metCount).toBe(2);
  });

  it("strength tiers reflect exhibit count (0/1/2/3+)", async (ctx) => {
    const d = gate(ctx);
    // press → criterion 3; insert three to land on "strong".
    await insertDoc(d, { documentType: "press" });
    await insertDoc(d, { documentType: "press" });
    await insertDoc(d, { documentType: "press" });
    // award → criterion 1; one only → "weak".
    await insertDoc(d, { documentType: "award" });
    // membership → criterion 2; two → "moderate".
    await insertDoc(d, { documentType: "membership" });
    await insertDoc(d, { documentType: "membership" });
    const result = await callAs(ATTORNEY).case.criteriaCoverage({
      caseId: CASE_ID,
    });
    expect(rowFor(result.rows, 1)?.strength).toBe("weak");
    expect(rowFor(result.rows, 2)?.strength).toBe("moderate");
    expect(rowFor(result.rows, 3)?.strength).toBe("strong");
  });

  it("RLS hides another attorney's case (NOT_FOUND)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(STRANGER).case.criteriaCoverage({ caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// requiredDocsCoverage
// ─────────────────────────────────────────────────────────────────────

describe("case.requiredDocsCoverage", () => {
  it("returns 14 items with present=false on an empty case (manual rows null)", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.requiredDocsCoverage({
      caseId: CASE_ID,
    });
    expect(r.visaSupported).toBe(true);
    expect(r.items).toHaveLength(14);
    // Manual rows (passport, i94, degree, citation_report) have no
    // docType → present is null, not false.
    const passport = r.items.find((i) => i.key === "passport");
    expect(passport?.present).toBeNull();
    const cv = r.items.find((i) => i.key === "cv");
    expect(cv?.present).toBe(false);
  });

  it("rec_letters needs minCount=3 to flip to present", async (ctx) => {
    const d = gate(ctx);
    await insertDoc(d, { documentType: "recommendation_letter" });
    await insertDoc(d, { documentType: "recommendation_letter" });
    const partial = await callAs(ATTORNEY).case.requiredDocsCoverage({
      caseId: CASE_ID,
    });
    const recPartial = partial.items.find((i) => i.key === "rec_letters");
    expect(recPartial?.count).toBe(2);
    expect(recPartial?.present).toBe(false);

    await insertDoc(d, { documentType: "recommendation_letter" });
    const full = await callAs(ATTORNEY).case.requiredDocsCoverage({
      caseId: CASE_ID,
    });
    const recFull = full.items.find((i) => i.key === "rec_letters");
    expect(recFull?.count).toBe(3);
    expect(recFull?.present).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// storageUsage
// ─────────────────────────────────────────────────────────────────────

describe("case.storageUsage", () => {
  it("sums sizeBytes across live documents and exposes the cap", async (ctx) => {
    const d = gate(ctx);
    await insertDoc(d, { documentType: "cv_resume", sizeBytes: 1_000n });
    await insertDoc(d, { documentType: "publication", sizeBytes: 2_000_000n });
    const r = await callAs(ATTORNEY).case.storageUsage({ caseId: CASE_ID });
    expect(r.usedBytes).toBe(2_001_000n);
    expect(r.documentCount).toBe(2);
    expect(r.capBytes).toBe(BigInt(PER_CASE_STORAGE_BYTES));
  });

  it("returns 0 bytes / 0 docs on an empty case", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.storageUsage({ caseId: CASE_ID });
    expect(r.usedBytes).toBe(0n);
    expect(r.documentCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// preflight
// ─────────────────────────────────────────────────────────────────────

describe("case.preflight", () => {
  it("returns the 4 gates and `allOk=false` on a fresh case", async (ctx) => {
    gate(ctx);
    const r = await callAs(ATTORNEY).case.preflight({ caseId: CASE_ID });
    expect(r.gates.map((g) => g.id)).toEqual([
      "outputs_approved",
      "criteria_threshold",
      "recommender_letters",
      "attorney_bar_active",
    ]);
    // Attorney profile is active in seed → that gate passes; the rest fail.
    expect(r.allOk).toBe(false);
    const byId = new Map(r.gates.map((g) => [g.id, g.ok]));
    expect(byId.get("outputs_approved")).toBe(false);
    expect(byId.get("criteria_threshold")).toBe(false);
    expect(byId.get("recommender_letters")).toBe(false);
    expect(byId.get("attorney_bar_active")).toBe(true);
  });

  it("flips outputs + recommender + criteria gates when data is in place", async (ctx) => {
    const d = gate(ctx);
    // Three press exhibits → criterion 3 strong (1 met). Add publication
    // (criteria 4+6) and award (1) so 4 of 8 criteria are met — over
    // the 3-of-8 threshold.
    await insertDoc(d, { documentType: "press" });
    await insertDoc(d, { documentType: "press" });
    await insertDoc(d, { documentType: "press" });
    await insertDoc(d, { documentType: "publication" });
    await insertDoc(d, { documentType: "award" });
    // Approved petition letter → outputs_approved gate flips.
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "petition_letter",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: "petition v1",
      attorneyApproved: true,
    });
    // Approved recommendation letter → recommender_letters gate flips.
    await d.insert(caseOutputs).values({
      caseId: CASE_ID,
      outputType: "recommendation_letter_template",
      outputVersion: 1,
      isCurrent: true,
      author: "computer",
      content: "rec v1",
      attorneyApproved: true,
      subgroupKey: "rec-a",
    });

    const r = await callAs(ATTORNEY).case.preflight({ caseId: CASE_ID });
    expect(r.allOk).toBe(true);
    expect(r.gates.every((g) => g.ok)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// setPackageOrder
// ─────────────────────────────────────────────────────────────────────

describe("case.setPackageOrder", () => {
  it("persists the ordered keys array to cases.package_order", async (ctx) => {
    const d = gate(ctx);
    const keys = ["petition_letter", "recommendation_letter_template:rec-a"];
    const r = await callAs(ATTORNEY).case.setPackageOrder({
      caseId: CASE_ID,
      orderedKeys: keys,
    });
    expect(r.ok).toBe(true);
    expect(r.orderedKeys).toEqual(keys);

    const [row] = await d
      .select({ packageOrder: cases.packageOrder })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.packageOrder).toEqual(keys);
  });

  it("clears the column when orderedKeys is empty (null, not [])", async (ctx) => {
    const d = gate(ctx);
    // Seed an order to overwrite.
    await d
      .update(cases)
      .set({ packageOrder: ["petition_letter"] })
      .where(eq(cases.id, CASE_ID));
    const r = await callAs(ATTORNEY).case.setPackageOrder({
      caseId: CASE_ID,
      orderedKeys: [],
    });
    expect(r.orderedKeys).toEqual([]);
    const [row] = await d
      .select({ packageOrder: cases.packageOrder })
      .from(cases)
      .where(eq(cases.id, CASE_ID));
    expect(row?.packageOrder).toBeNull();
  });

  it("rejects > 50 keys via Zod", async (ctx) => {
    gate(ctx);
    const tooMany = Array.from({ length: 51 }, (_, i) => `k${i}`);
    await expect(
      callAs(ATTORNEY).case.setPackageOrder({
        caseId: CASE_ID,
        orderedKeys: tooMany,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("NOT_FOUND when the caller can't see the case (RLS)", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(STRANGER).case.setPackageOrder({
        caseId: CASE_ID,
        orderedKeys: ["petition_letter"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function rowFor<T extends { code: number }>(
  rows: ReadonlyArray<T>,
  code: number,
): T | undefined {
  return rows.find((r) => r.code === code);
}

let docCounter = 0;
async function insertDoc(
  d: TestDb,
  args: {
    documentType:
      | "cv_resume"
      | "publication"
      | "patent"
      | "press"
      | "award"
      | "membership"
      | "recommendation_letter"
      | "employment_letter"
      | "salary_evidence"
      | "other";
    sizeBytes?: bigint;
  },
): Promise<void> {
  docCounter += 1;
  // sha256 is exactly 64 chars; vary the suffix per insert so the
  // unique constraint never collides across tests.
  const sha = String(docCounter).padStart(64, "0");
  await d.insert(caseDocuments).values({
    caseId: CASE_ID,
    uploadedBy: ATTORNEY,
    documentType: args.documentType,
    originalFilename: `doc-${docCounter}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: args.sizeBytes ?? 1024n,
    sha256: sha,
    storagePath: `/test/doc-${docCounter}.pdf`,
    extractionStatus: "completed",
  });
}

async function seed(d: TestDb): Promise<void> {
  await d.insert(users).values([
    { id: ATTORNEY, name: "Test Attorney CC", email: "cov-att@docket.local" },
    { id: STRANGER, name: "Stranger CC", email: "cov-str@docket.local" },
  ]);
  await d.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: STRANGER, role: "attorney" },
  ]);
  await d.insert(organizations).values({
    id: ORG,
    name: "Coverage Org",
    slug: "case-coverage-test-org",
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
  await d.execute(sql`delete from case_outputs where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from case_documents where case_id = ${CASE_ID}`);
  await d.execute(sql`delete from cases where id = ${CASE_ID}`);
  await d.execute(
    sql`delete from attorney_profiles where user_id in (${ATTORNEY}, ${STRANGER})`,
  );
  await d.execute(
    sql`delete from organization_members where organization_id = ${ORG}`,
  );
  await d.execute(sql`delete from organizations where id = ${ORG}`);
  await d.execute(
    sql`delete from user_roles where user_id in (${ATTORNEY}, ${STRANGER})`,
  );
  await d.execute(
    sql`delete from users where id in (${ATTORNEY}, ${STRANGER})`,
  );
}
