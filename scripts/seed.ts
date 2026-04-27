/**
 * Run with: `pnpm db:seed`
 *
 * Idempotent dev seed. Builds a realistic graph that exercises every
 * Phase 1 surface:
 *   - 1 admin + 2 attorneys + 1 paralegal
 *   - 2 organizations (multi-tenant sanity check)
 *   - 3 cases in different statuses (intake / draft_ready / delivered+invoiced)
 *   - 2 documents on the active case
 *   - 2 outputs (one current, one historical) on the draft case
 *   - 1 compute-ledger entry, 1 case event, 1 audit-log entry
 *   - 2 waitlist entries
 *
 * All names use the `Test ...` prefix per CLAUDE.md §9.
 *
 * Connects via the standard Drizzle client (DB owner role) — bypasses RLS
 * the same way Stage 02 service code will. Re-running is safe: every insert
 * is keyed on a stable id and uses `onConflictDoNothing()`.
 *
 * SAFETY: refuses to run when NODE_ENV=production.
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[seed] DATABASE_URL is not set");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("[seed] refuses to run with NODE_ENV=production");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1, prepare: false });
const db = drizzle(client);

/** Cents columns are bigint on the schema; this keeps the call sites tidy. */
const cents = (n: number): bigint => BigInt(n);

/** Step logger — single source for the `[seed] foo…` prefix. */
const step = (label: string): void => console.log(`[seed] ${label}…`);

// Stable UUIDs so re-runs hit the same rows.
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ATTORNEY_ID = "22222222-2222-4222-8222-222222222222";
const ATTORNEY2_ID = "22222222-2222-4222-8222-222222222223";
const PARALEGAL_ID = "22222222-2222-4222-8222-222222222224";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const ORG2_ID = "33333333-3333-4333-8333-333333333334";
const CASE_INTAKE_ID = "44444444-4444-4444-8444-444444444444";
const CASE_DRAFT_ID = "44444444-4444-4444-8444-444444444445";
const CASE_DELIVERED_ID = "44444444-4444-4444-8444-444444444446";
const DOC1_ID = "55555555-5555-4555-8555-555555555551";
const DOC2_ID = "55555555-5555-4555-8555-555555555552";
const OUTPUT_OLD_ID = "66666666-6666-4666-8666-666666666661";
const OUTPUT_CURRENT_ID = "66666666-6666-4666-8666-666666666662";
const LEDGER_ID = "77777777-7777-4777-8777-777777777771";
const EVENT_ID = "88888888-8888-4888-8888-888888888881";
const AUDIT_ID = "99999999-9999-4999-8999-999999999991";
const WAITLIST1_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const WAITLIST2_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

async function main(): Promise<void> {
  step("users");
  await db
    .insert(users)
    .values([
      { id: ADMIN_ID, name: "Test Admin", email: "test-admin@docket.local", emailVerified: new Date() },
      { id: ATTORNEY_ID, name: "Test Attorney Primary", email: "test-attorney@docket.local", emailVerified: new Date() },
      { id: ATTORNEY2_ID, name: "Test Attorney Secondary", email: "test-attorney-2@docket.local", emailVerified: new Date() },
      { id: PARALEGAL_ID, name: "Test Paralegal", email: "test-paralegal@docket.local", emailVerified: new Date() },
    ])
    .onConflictDoNothing({ target: users.id });

  step("roles");
  await db
    .insert(userRoles)
    .values([
      { userId: ADMIN_ID, role: "admin" },
      { userId: ATTORNEY_ID, role: "attorney" },
      { userId: ATTORNEY2_ID, role: "attorney" },
    ])
    .onConflictDoNothing();

  step("attorney profiles");
  await db
    .insert(attorneyProfiles)
    .values([
      { userId: ATTORNEY_ID, barNumber: "TEST-12345", barStates: ["NY"], status: "active", acceptedTermsVersion: "v1" },
      { userId: ATTORNEY2_ID, barNumber: "TEST-67890", barStates: ["CA"], status: "pending" },
    ])
    .onConflictDoNothing();

  step("organizations");
  await db
    .insert(organizations)
    .values([
      { id: ORG_ID, name: "Test Solo Practice", slug: "test-solo-practice", billingEmail: "billing@docket.local" },
      { id: ORG2_ID, name: "Test Other Firm", slug: "test-other-firm", billingEmail: "billing-2@docket.local" },
    ])
    .onConflictDoNothing({ target: organizations.id });

  step("organization members");
  await db
    .insert(organizationMembers)
    .values([
      { organizationId: ORG_ID, userId: ATTORNEY_ID, role: "owner", status: "active", acceptedAt: new Date() },
      { organizationId: ORG_ID, userId: ADMIN_ID, role: "admin", status: "active", acceptedAt: new Date() },
      { organizationId: ORG_ID, userId: PARALEGAL_ID, role: "member", status: "active", acceptedAt: new Date() },
      { organizationId: ORG2_ID, userId: ATTORNEY2_ID, role: "owner", status: "active", acceptedAt: new Date() },
    ])
    .onConflictDoNothing();

  step("cases");
  await db
    .insert(cases)
    .values([
      {
        id: CASE_INTAKE_ID,
        organizationId: ORG_ID,
        visaType: "O-1A",
        status: "intake",
        beneficiaryData: { fullName: "Test Beneficiary Alpha", nationality: "Canada", occupation: "Software Engineer" },
      },
      {
        id: CASE_DRAFT_ID,
        organizationId: ORG_ID,
        visaType: "EB-1A",
        status: "draft_ready",
        beneficiaryData: { fullName: "Test Beneficiary Bravo", nationality: "United Kingdom", occupation: "Researcher" },
        caseFeeCents: cents(600000),       // $6,000
        docketShareCents: cents(90000),    // $900 (15%)
        attorneyShareCents: cents(510000),
        revenueStatus: "pending",
      },
      {
        id: CASE_DELIVERED_ID,
        organizationId: ORG_ID,
        visaType: "O-1A",
        status: "delivered",
        beneficiaryData: { fullName: "Test Beneficiary Charlie", nationality: "Germany", occupation: "Conductor" },
        caseFeeCents: cents(800000),
        docketShareCents: cents(120000),
        attorneyShareCents: cents(680000),
        revenueStatus: "invoiced",
        filedAt: new Date(),
      },
    ])
    .onConflictDoNothing({ target: cases.id });

  step("case participants");
  await db
    .insert(caseParticipants)
    .values([
      { caseId: CASE_INTAKE_ID, userId: ATTORNEY_ID, role: "attorney", isPrimary: true },
      { caseId: CASE_DRAFT_ID, userId: ATTORNEY_ID, role: "attorney", isPrimary: true },
      { caseId: CASE_DRAFT_ID, userId: PARALEGAL_ID, role: "paralegal", isPrimary: false, addedBy: ATTORNEY_ID },
      { caseId: CASE_DELIVERED_ID, userId: ATTORNEY_ID, role: "attorney", isPrimary: true },
    ])
    .onConflictDoNothing();

  step("case documents");
  await db
    .insert(caseDocuments)
    .values([
      {
        id: DOC1_ID,
        caseId: CASE_DRAFT_ID,
        uploadedBy: ATTORNEY_ID,
        documentType: "cv_resume",
        originalFilename: "test-beneficiary-cv.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(245678),
        sha256: "a".repeat(64),
        storagePath: `cases/${CASE_DRAFT_ID}/${DOC1_ID}/test-beneficiary-cv.pdf`,
        extractionStatus: "completed",
        extractedText: "Test extracted CV content [FAKE-CITE]",
        extractedAt: new Date(),
      },
      {
        id: DOC2_ID,
        caseId: CASE_DRAFT_ID,
        uploadedBy: ATTORNEY_ID,
        documentType: "publication",
        originalFilename: "test-publication.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(987654),
        sha256: "b".repeat(64),
        storagePath: `cases/${CASE_DRAFT_ID}/${DOC2_ID}/test-publication.pdf`,
        extractionStatus: "pending",
      },
    ])
    .onConflictDoNothing({ target: caseDocuments.id });

  step("case outputs (versioned)");
  await db
    .insert(caseOutputs)
    .values([
      {
        id: OUTPUT_OLD_ID,
        caseId: CASE_DRAFT_ID,
        outputType: "personal_statement",
        outputVersion: 1,
        isCurrent: false,
        title: "Personal Statement (v1)",
        content: "Test draft content version 1 [FAKE-CITE]",
        author: "computer",
        promptTokens: 1200,
        completionTokens: 3400,
        computeDurationMs: 18000,
        costCents: cents(450),
      },
      {
        id: OUTPUT_CURRENT_ID,
        caseId: CASE_DRAFT_ID,
        outputType: "personal_statement",
        outputVersion: 2,
        isCurrent: true,
        pinned: true,
        title: "Personal Statement (v2)",
        content: "Test draft content version 2 — attorney edits applied [FAKE-CITE]",
        author: "attorney",
      },
    ])
    .onConflictDoNothing({ target: caseOutputs.id });

  step("compute ledger");
  await db
    .insert(caseComputeLedger)
    .values({
      id: LEDGER_ID,
      caseId: CASE_DRAFT_ID,
      outputId: OUTPUT_OLD_ID,
      entryType: "compute_spend",
      amountCents: cents(450),
      currency: "usd",
    })
    .onConflictDoNothing({ target: caseComputeLedger.id });

  step("case event");
  await db
    .insert(caseEvents)
    .values({
      id: EVENT_ID,
      caseId: CASE_DRAFT_ID,
      actorType: "computer",
      eventType: "output_generated",
      details: { reason: "initial build" },
    })
    .onConflictDoNothing({ target: caseEvents.id });

  step("audit log");
  await db
    .insert(auditLog)
    .values({
      id: AUDIT_ID,
      actorType: "user",
      actorUserId: ADMIN_ID,
      action: "attorney.activate",
      targetType: "user",
      targetId: ATTORNEY_ID,
      details: { reason: "initial seed activation" },
    })
    .onConflictDoNothing({ target: auditLog.id });

  step("waitlist entries");
  await db
    .insert(waitlistEntries)
    .values([
      { id: WAITLIST1_ID, email: "test-waitlist-1@docket.local", name: "Test Waiter One", source: "landing", utmSource: "twitter" },
      { id: WAITLIST2_ID, email: "test-waitlist-2@docket.local", name: "Test Waiter Two", source: "landing", utmSource: "linkedin" },
    ])
    .onConflictDoNothing({ target: waitlistEntries.id });

  // Sanity counts
  const counts = await db.execute<{
    cases: number;
    docs: number;
    outputs: number;
    waitlist: number;
  }>(sql`
    select
      (select count(*)::int from cases) as cases,
      (select count(*)::int from case_documents) as docs,
      (select count(*)::int from case_outputs) as outputs,
      (select count(*)::int from waitlist_entries) as waitlist
  `);
  const c = counts[0];
  console.log(
    `[seed] done — cases:${c?.cases ?? 0} docs:${c?.docs ?? 0} outputs:${c?.outputs ?? 0} waitlist:${c?.waitlist ?? 0}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
