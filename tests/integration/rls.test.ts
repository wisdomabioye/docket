import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  attorneyProfiles,
  auditLog,
  caseComputeLedger,
  caseDocuments,
  caseEvents,
  caseOutputs,
  caseParticipants,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
  waitlistEntries,
} from "@/server/db/schema";
import {
  asUser,
  closeTestDb,
  getTestDb,
  rlsRoleExists,
  type TestDb,
} from "../helpers/db";

/**
 * RLS behavioral coverage. Connects through `app_user` (non-bypass role)
 * + per-test session GUC, then asserts cross-user isolation across every
 * RLS-protected table.
 *
 * Skip conditions, checked at runtime in each test via `gate(ctx)`:
 *   - `DATABASE_URL` unset
 *   - `app_user` role missing (apply the `app_role` custom migration)
 *
 * Why `gate()` and not `it.skipIf(...)`: vitest evaluates `skipIf` at
 * module-load time, before `beforeAll` has had a chance to probe the DB.
 * `gate()` reads live state on each test, calling `ctx.skip()` when the
 * suite shouldn't run.
 *
 * Test data is seeded once (in beforeAll) using the owner role, which
 * bypasses RLS. Each `asUser()` call wraps in a transaction that's rolled
 * back so concurrent tests don't interfere.
 */

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARALEGAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ALICE_ORG = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const BOB_ORG = "11111111-1111-4111-8111-bbbbbbbbbbbb";

const ALICE_CASE = "22222222-2222-4222-8222-aaaaaaaaaaaa";
const BOB_CASE = "22222222-2222-4222-8222-bbbbbbbbbbbb";

const ALICE_DOC = "33333333-3333-4333-8333-aaaaaaaaaaaa";
const BOB_DOC = "33333333-3333-4333-8333-bbbbbbbbbbbb";

const ALICE_OUTPUT = "44444444-4444-4444-8444-aaaaaaaaaaaa";
const BOB_OUTPUT = "44444444-4444-4444-8444-bbbbbbbbbbbb";

const ALICE_EVENT = "55555555-5555-4555-8555-aaaaaaaaaaaa";
const BOB_EVENT = "55555555-5555-4555-8555-bbbbbbbbbbbb";

const ALICE_LEDGER = "66666666-6666-4666-8666-aaaaaaaaaaaa";
const BOB_LEDGER = "66666666-6666-4666-8666-bbbbbbbbbbbb";

const ALICE_AUDIT = "77777777-7777-4777-8777-aaaaaaaaaaaa";
const ALICE_WAITLIST = "88888888-8888-4888-8888-aaaaaaaaaaaa";

const SOFT_DELETED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let rlsReady = false;

function gate(ctx: { skip: () => void }): TestDb {
  const db = getTestDb();
  if (!db || !rlsReady) {
    ctx.skip();
    // ctx.skip() throws — this satisfies the type checker.
    throw new Error("unreachable");
  }
  return db;
}

beforeAll(async () => {
  const db = getTestDb();
  if (!db) return;
  rlsReady = await rlsRoleExists(db);
  if (!rlsReady) return;
  await teardown(db);
  await seed(db);
});

afterAll(async () => {
  const db = getTestDb();
  if (db) await teardown(db);
  await closeTestDb();
});

// ── users ────────────────────────────────────────────────────────────────

describe("RLS — users", () => {
  it("alice sees own user row", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(users).where(eq(users.id, ALICE)),
    );
    expect(r).toHaveLength(1);
  });

  it("alice cannot see bob's user row", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(users).where(eq(users.id, BOB)),
    );
    expect(r).toHaveLength(0);
  });

  it("admin sees everyone", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ADMIN, (tx) => tx.select().from(users));
    expect(r.length).toBeGreaterThanOrEqual(4);
  });

  it("soft-deleted user cannot see their own row", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, SOFT_DELETED, (tx) =>
      tx.select().from(users).where(eq(users.id, SOFT_DELETED)),
    );
    expect(r).toHaveLength(0);
  });

  it("unauthenticated session sees zero rows", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, null, (tx) => tx.select().from(users));
    expect(r).toHaveLength(0);
  });
});

// ── attorney_profiles ───────────────────────────────────────────────────

describe("RLS — attorney_profiles", () => {
  it("alice sees own profile", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(attorneyProfiles)
        .where(eq(attorneyProfiles.userId, ALICE)),
    );
    expect(r).toHaveLength(1);
  });

  it("alice cannot see bob's profile", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(attorneyProfiles)
        .where(eq(attorneyProfiles.userId, BOB)),
    );
    expect(r).toHaveLength(0);
  });
});

// ── organizations & members ─────────────────────────────────────────────

describe("RLS — organizations / members", () => {
  it("alice sees her org", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, ALICE_ORG)),
    );
    expect(r).toHaveLength(1);
  });

  it("alice cannot see bob's org", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, BOB_ORG)),
    );
    expect(r).toHaveLength(0);
  });

  it("alice sees own membership row", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, ALICE)),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("alice cannot see members of bob's org", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, BOB_ORG)),
    );
    expect(r).toHaveLength(0);
  });
});

// ── cases & participants ────────────────────────────────────────────────

describe("RLS — cases / participants", () => {
  it("alice sees her case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(cases).where(eq(cases.id, ALICE_CASE)),
    );
    expect(r).toHaveLength(1);
  });

  it("alice cannot see bob's case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(cases).where(eq(cases.id, BOB_CASE)),
    );
    expect(r).toHaveLength(0);
  });

  it("admin sees all cases", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ADMIN, (tx) => tx.select().from(cases));
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it("paralegal on alice's case can read it", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, PARALEGAL, (tx) =>
      tx.select().from(cases).where(eq(cases.id, ALICE_CASE)),
    );
    expect(r).toHaveLength(1);
  });

  it("alice (primary) can see her own case_participants", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(caseParticipants)
        .where(eq(caseParticipants.caseId, ALICE_CASE)),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});

// ── case_documents / outputs / events / ledger ──────────────────────────

describe("RLS — case child tables", () => {
  it("alice sees docs on her case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(caseDocuments)
        .where(eq(caseDocuments.caseId, ALICE_CASE)),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("alice cannot see docs on bob's case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(caseDocuments)
        .where(eq(caseDocuments.caseId, BOB_CASE)),
    );
    expect(r).toHaveLength(0);
  });

  it("alice sees outputs on her case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(caseOutputs).where(eq(caseOutputs.caseId, ALICE_CASE)),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("alice cannot see outputs on bob's case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(caseOutputs).where(eq(caseOutputs.caseId, BOB_CASE)),
    );
    expect(r).toHaveLength(0);
  });

  it("alice sees events on her case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(caseEvents).where(eq(caseEvents.caseId, ALICE_CASE)),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("alice cannot see events on bob's case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx.select().from(caseEvents).where(eq(caseEvents.caseId, BOB_CASE)),
    );
    expect(r).toHaveLength(0);
  });

  it("alice sees ledger entries on her case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(caseComputeLedger)
        .where(eq(caseComputeLedger.caseId, ALICE_CASE)),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("alice cannot see ledger entries on bob's case", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) =>
      tx
        .select()
        .from(caseComputeLedger)
        .where(eq(caseComputeLedger.caseId, BOB_CASE)),
    );
    expect(r).toHaveLength(0);
  });
});

// ── audit_log ───────────────────────────────────────────────────────────

describe("RLS — audit_log (admin-only)", () => {
  it("admin sees audit rows", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ADMIN, (tx) => tx.select().from(auditLog));
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("alice cannot read audit rows", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) => tx.select().from(auditLog));
    expect(r).toHaveLength(0);
  });
});

// ── waitlist_entries ────────────────────────────────────────────────────

describe("RLS — waitlist_entries", () => {
  it("admin can read waitlist", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ADMIN, (tx) => tx.select().from(waitlistEntries));
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("non-admin cannot read waitlist", async (ctx) => {
    const db = gate(ctx);
    const r = await asUser(db, ALICE, (tx) => tx.select().from(waitlistEntries));
    expect(r).toHaveLength(0);
  });

  it("anyone can insert into waitlist (no exception)", async (ctx) => {
    const db = gate(ctx);
    // asUser wraps + rolls back, so the row doesn't persist; we only
    // care that the INSERT itself isn't rejected by RLS. No `.returning()`
    // because anon has no SELECT policy.
    await expect(
      asUser(db, null, async (tx) => {
        await tx.insert(waitlistEntries).values({
          email: `rls-anon-${Date.now()}@docket.local`,
          name: "Test Anon",
          source: "rls-test",
        });
      }),
    ).resolves.not.toThrow();
  });
});

// ── Seed helpers ────────────────────────────────────────────────────────

async function seed(db: TestDb): Promise<void> {
  await db
    .insert(users)
    .values([
      { id: ALICE, name: "Test Alice", email: "rls-alice@docket.local" },
      { id: BOB, name: "Test Bob", email: "rls-bob@docket.local" },
      { id: ADMIN, name: "Test RLS Admin", email: "rls-admin@docket.local" },
      {
        id: PARALEGAL,
        name: "Test RLS Paralegal",
        email: "rls-paralegal@docket.local",
      },
      {
        id: SOFT_DELETED,
        name: "Test RLS SoftDeleted",
        email: "rls-deleted@docket.local",
        deletedAt: new Date(),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(userRoles)
    .values([
      { userId: ALICE, role: "attorney" },
      { userId: BOB, role: "attorney" },
      { userId: ADMIN, role: "admin" },
    ])
    .onConflictDoNothing();

  await db
    .insert(attorneyProfiles)
    .values([
      { userId: ALICE, barNumber: "RLS-A-1", barStates: ["NY"], status: "active" },
      { userId: BOB, barNumber: "RLS-B-1", barStates: ["CA"], status: "active" },
    ])
    .onConflictDoNothing();

  await db
    .insert(organizations)
    .values([
      { id: ALICE_ORG, name: "Alice Org", slug: "rls-alice-org" },
      { id: BOB_ORG, name: "Bob Org", slug: "rls-bob-org" },
    ])
    .onConflictDoNothing();

  await db
    .insert(organizationMembers)
    .values([
      { organizationId: ALICE_ORG, userId: ALICE, role: "owner" },
      { organizationId: BOB_ORG, userId: BOB, role: "owner" },
    ])
    .onConflictDoNothing();

  await db
    .insert(cases)
    .values([
      { id: ALICE_CASE, organizationId: ALICE_ORG, visaType: "O-1A" },
      { id: BOB_CASE, organizationId: BOB_ORG, visaType: "EB-1A" },
    ])
    .onConflictDoNothing();

  await db
    .insert(caseParticipants)
    .values([
      { caseId: ALICE_CASE, userId: ALICE, role: "attorney", isPrimary: true },
      { caseId: ALICE_CASE, userId: PARALEGAL, role: "paralegal", addedBy: ALICE },
      { caseId: BOB_CASE, userId: BOB, role: "attorney", isPrimary: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(caseDocuments)
    .values([
      {
        id: ALICE_DOC,
        caseId: ALICE_CASE,
        uploadedBy: ALICE,
        documentType: "cv_resume",
        originalFilename: "alice.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(100),
        sha256: "a".repeat(64),
        storagePath: "rls/alice.pdf",
      },
      {
        id: BOB_DOC,
        caseId: BOB_CASE,
        uploadedBy: BOB,
        documentType: "cv_resume",
        originalFilename: "bob.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(100),
        sha256: "b".repeat(64),
        storagePath: "rls/bob.pdf",
      },
    ])
    .onConflictDoNothing({ target: caseDocuments.id });

  await db
    .insert(caseOutputs)
    .values([
      {
        id: ALICE_OUTPUT,
        caseId: ALICE_CASE,
        outputType: "personal_statement",
        outputVersion: 1,
        title: "Alice draft",
        content: "test",
      },
      {
        id: BOB_OUTPUT,
        caseId: BOB_CASE,
        outputType: "personal_statement",
        outputVersion: 1,
        title: "Bob draft",
        content: "test",
      },
    ])
    .onConflictDoNothing({ target: caseOutputs.id });

  await db
    .insert(caseEvents)
    .values([
      { id: ALICE_EVENT, caseId: ALICE_CASE, actorType: "system", eventType: "rls_seed" },
      { id: BOB_EVENT, caseId: BOB_CASE, actorType: "system", eventType: "rls_seed" },
    ])
    .onConflictDoNothing({ target: caseEvents.id });

  await db
    .insert(caseComputeLedger)
    .values([
      {
        id: ALICE_LEDGER,
        caseId: ALICE_CASE,
        entryType: "compute_spend",
        amountCents: BigInt(100),
      },
      {
        id: BOB_LEDGER,
        caseId: BOB_CASE,
        entryType: "compute_spend",
        amountCents: BigInt(100),
      },
    ])
    .onConflictDoNothing({ target: caseComputeLedger.id });

  await db
    .insert(auditLog)
    .values({
      id: ALICE_AUDIT,
      actorType: "user",
      actorUserId: ADMIN,
      action: "rls.seed",
      targetType: "case",
      targetId: ALICE_CASE,
    })
    .onConflictDoNothing({ target: auditLog.id });

  await db
    .insert(waitlistEntries)
    .values({
      id: ALICE_WAITLIST,
      email: "rls-waitlist@docket.local",
      source: "rls-test",
    })
    .onConflictDoNothing({ target: waitlistEntries.id });
}

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from case_compute_ledger where id in (${ALICE_LEDGER}, ${BOB_LEDGER})`);
  await db.execute(sql`delete from case_events where id in (${ALICE_EVENT}, ${BOB_EVENT})`);
  await db.execute(sql`delete from case_outputs where id in (${ALICE_OUTPUT}, ${BOB_OUTPUT})`);
  await db.execute(sql`delete from case_documents where id in (${ALICE_DOC}, ${BOB_DOC})`);
  await db.execute(sql`delete from case_participants where case_id in (${ALICE_CASE}, ${BOB_CASE})`);
  await db.execute(sql`delete from cases where id in (${ALICE_CASE}, ${BOB_CASE})`);
  await db.execute(sql`delete from organization_members where organization_id in (${ALICE_ORG}, ${BOB_ORG})`);
  await db.execute(sql`delete from organizations where id in (${ALICE_ORG}, ${BOB_ORG})`);
  await db.execute(sql`delete from attorney_profiles where user_id in (${ALICE}, ${BOB})`);
  await db.execute(sql`delete from user_roles where user_id in (${ALICE}, ${BOB}, ${ADMIN})`);
  await db.execute(sql`delete from audit_log where id = ${ALICE_AUDIT}`);
  await db.execute(sql`delete from waitlist_entries where source = 'rls-test'`);
  await db.execute(sql`delete from users where id in (${ALICE}, ${BOB}, ${ADMIN}, ${PARALEGAL}, ${SOFT_DELETED})`);
}
