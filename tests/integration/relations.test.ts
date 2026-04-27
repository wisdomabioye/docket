// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  caseDocuments,
  caseEvents,
  caseOutputs,
  caseParticipants,
  cases,
  organizationMembers,
  organizations,
  userRoles,
  users,
} from "@/server/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "../helpers/db";

/**
 * Smoke tests for Drizzle relations (`server/db/schema/relations.ts`).
 *
 * If a relation declaration has a wrong field/references pair, the typo
 * shows up only at runtime when the first `.findMany({ with: ... })`
 * fires. One probe per major relation catches it at test time.
 *
 * Owner connection — RLS bypassed. We're not testing RLS here, just
 * that the relation graph resolves.
 */

const USER = "20000000-0000-4000-8000-aaaa00000001";
const ORG = "20000000-0000-4000-8000-bbbb00000001";
const CASE = "20000000-0000-4000-8000-cccc00000001";
const DOC = "20000000-0000-4000-8000-dddd00000001";
const OUTPUT = "20000000-0000-4000-8000-eeee00000001";
const EVENT = "20000000-0000-4000-8000-ffff00000001";

let db: TestDb | null = null;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  await teardown(db);
  await seed(db);
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("Drizzle relations — smoke", () => {
  it("users → memberships → organizations resolves", async (ctx) => {
    const db = gate(ctx);
    const result = await db.query.users.findFirst({
      where: eq(users.id, USER),
      with: {
        organizationMemberships: {
          with: { organization: true },
        },
      },
    });
    expect(result?.id).toBe(USER);
    expect(result?.organizationMemberships).toHaveLength(1);
    expect(result?.organizationMemberships[0]?.organization.id).toBe(ORG);
  });

  it("cases → participants + documents + outputs + events resolves", async (ctx) => {
    const db = gate(ctx);
    const result = await db.query.cases.findFirst({
      where: eq(cases.id, CASE),
      with: {
        participants: true,
        documents: true,
        outputs: true,
        events: true,
        organization: true,
      },
    });
    expect(result?.id).toBe(CASE);
    expect(result?.participants).toHaveLength(1);
    expect(result?.documents).toHaveLength(1);
    expect(result?.outputs).toHaveLength(1);
    expect(result?.events).toHaveLength(1);
    expect(result?.organization.id).toBe(ORG);
  });

  it("case_outputs → compute ledger entries resolves", async (ctx) => {
    const db = gate(ctx);
    const result = await db.query.caseOutputs.findFirst({
      where: eq(caseOutputs.id, OUTPUT),
      with: { computeEntries: true, case: true },
    });
    expect(result?.id).toBe(OUTPUT);
    expect(result?.case.id).toBe(CASE);
  });

  it("user_roles → user (back-ref via grantedBy works distinctly)", async (ctx) => {
    const db = gate(ctx);
    const role = await db.query.userRoles.findFirst({
      where: eq(userRoles.userId, USER),
      with: { user: true, grantedBy: true },
    });
    expect(role?.user.id).toBe(USER);
    expect(role?.grantedBy).toBeNull(); // not set in seed
  });
});

// ── seed ────────────────────────────────────────────────────────────────

async function seed(db: TestDb): Promise<void> {
  await db.insert(users).values({
    id: USER,
    name: "Test Rel",
    email: "rel-user@docket.local",
  });
  await db
    .insert(userRoles)
    .values({ userId: USER, role: "attorney" });
  await db
    .insert(organizations)
    .values({ id: ORG, name: "Rel Org", slug: "rel-org-test" });
  await db.insert(organizationMembers).values({
    organizationId: ORG,
    userId: USER,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
  await db
    .insert(cases)
    .values({ id: CASE, organizationId: ORG, visaType: "O-1A" });
  await db.insert(caseParticipants).values({
    caseId: CASE,
    userId: USER,
    role: "attorney",
    isPrimary: true,
  });
  await db.insert(caseDocuments).values({
    id: DOC,
    caseId: CASE,
    uploadedBy: USER,
    documentType: "cv_resume",
    originalFilename: "rel.pdf",
    mimeType: "application/pdf",
    sizeBytes: BigInt(100),
    sha256: "f".repeat(64),
    storagePath: "rel/test.pdf",
  });
  await db.insert(caseOutputs).values({
    id: OUTPUT,
    caseId: CASE,
    outputType: "personal_statement",
    outputVersion: 1,
    title: "Rel draft",
    content: "test",
  });
  await db.insert(caseEvents).values({
    id: EVENT,
    caseId: CASE,
    actorType: "system",
    eventType: "rel_seed",
  });
}

async function teardown(db: TestDb): Promise<void> {
  await db.execute(sql`delete from case_events where id = ${EVENT}`);
  await db.execute(sql`delete from case_outputs where id = ${OUTPUT}`);
  await db.execute(sql`delete from case_documents where id = ${DOC}`);
  await db.execute(sql`delete from case_participants where case_id = ${CASE}`);
  await db.execute(sql`delete from cases where id = ${CASE}`);
  await db.execute(sql`delete from organization_members where organization_id = ${ORG}`);
  await db.execute(sql`delete from organizations where id = ${ORG}`);
  await db.execute(sql`delete from user_roles where user_id = ${USER}`);
  await db.execute(sql`delete from users where id = ${USER}`);
}
