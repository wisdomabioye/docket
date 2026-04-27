import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enums for fixed value sets. Changing an enum requires a migration
 * (`ALTER TYPE ... ADD VALUE`); for vocabularies that evolve frequently
 * (`case_events.event_type`) we use plain `text` + a constants file instead.
 *
 * Mirror these arrays in `lib/constants.ts` so client-side code can list
 * values without importing server modules.
 */

// User-level role. A user can have multiple via `user_roles`.
export const userRoleEnum = pgEnum("user_role", [
  "applicant", // Phase 2: end consumer of the case (kept now for fwd-compat)
  "attorney",
  "admin",
]);

// Per-org membership level (separate scope from `user_role`).
export const orgMemberRoleEnum = pgEnum("org_member_role", [
  "owner",
  "admin",
  "member",
]);

// Per-org member lifecycle.
export const orgMemberStatusEnum = pgEnum("org_member_status", [
  "invited",
  "active",
  "removed",
]);

// Attorney profile lifecycle.
export const attorneyStatusEnum = pgEnum("attorney_status", [
  "pending", // signup but not yet activated by admin
  "active",
  "suspended",
  "inactive",
]);

// Case visa types. Phase 1 ships O-1A + EB-1A; rest are forward-compat.
export const visaTypeEnum = pgEnum("visa_type", [
  "O-1A",
  "O-1B",
  "EB-1A",
  "EB-1B",
  "EB-2-NIW",
  "H-1B-transfer",
  "I-130",
  "N-400",
  "L-1A",
  "L-1B",
  "E-2",
  "TN",
  "other",
]);

// Case workflow status. Service layer enforces legal transitions
// (DB only stores the value).
export const caseStatusEnum = pgEnum("case_status", [
  "intake",            // beneficiary form open
  "documents_pending", // intake done, awaiting uploads
  "extracting",        // documents uploaded, OCR/parse in flight
  "ready_to_build",    // extraction done, awaiting attorney "Build" click
  "building",          // Computer is generating outputs
  "build_failed",
  "draft_ready",       // outputs generated, awaiting attorney review
  "in_review",
  "needs_revision",
  "approved",          // attorney approved package
  "package_ready",     // PDF package compiled
  "delivered",         // package downloaded by attorney
  "filed",             // attorney has filed with USCIS (manual mark)
  "archived",
]);

// Per-case participant role. Distinct from global `user_role`:
// a user with global role 'attorney' can be on case A as 'attorney'
// and on case B as 'observer'.
export const caseParticipantRoleEnum = pgEnum("case_participant_role", [
  "attorney",
  "paralegal",
  "applicant",
  "observer",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "cv_resume",
  "publication",
  "patent",
  "press",
  "award",
  "membership",
  "recommendation_letter",
  "employment_letter",
  "salary_evidence",
  "other",
]);

export const extractionStatusEnum = pgEnum("extraction_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const outputTypeEnum = pgEnum("output_type", [
  "personal_statement",
  "petition_letter",
  "recommendation_letter_template",
  "exhibit_index",
  "criteria_analysis",
  "evidence_plan",
  "cover_letter",
  "form_g1145",
  "other",
]);

// Who produced an output row.
export const outputAuthorEnum = pgEnum("output_author", [
  "computer", // Perplexity Computer
  "attorney", // attorney edit
  "system",   // automatic post-processing
]);

// Per-case revenue lifecycle.
export const revenueStatusEnum = pgEnum("revenue_status", [
  "pending",
  "invoiced",
  "paid",
  "waived",
  "failed",
]);

// `case_events.actor_type` — who emitted the event.
export const eventActorTypeEnum = pgEnum("event_actor_type", [
  "user",
  "system",
  "computer",
]);

// Generic ledger entry kinds. Currently used by `case_compute_ledger`.
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "compute_spend",
  "compute_credit",
  "manual_adjust",
]);
