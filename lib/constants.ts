/**
 * Plain TS constants mirroring server-only enum values, so client
 * components can list/iterate them without importing server modules.
 *
 * Per CLAUDE.md §2 stack table — keep in sync with `server/db/schema/enums.ts`.
 * If you add a value there, add it here and rerun tests.
 */

export const VISA_TYPES = [
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
] as const;

export type VisaType = (typeof VISA_TYPES)[number];

export const ATTORNEY_STATUSES = [
  "pending",
  "active",
  "suspended",
  "inactive",
] as const;

export type AttorneyStatus = (typeof ATTORNEY_STATUSES)[number];

export const DOCUMENT_TYPES = [
  "cv_resume",
  "publication",
  "patent",
  "press",
  "award",
  "membership",
  "recommendation_letter",
  "employment_letter",
  "salary_evidence",
  "peer_review",
  "critical_role",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  cv_resume: "CV / résumé",
  publication: "Publication",
  patent: "Patent",
  press: "Press / media",
  award: "Award",
  membership: "Membership",
  recommendation_letter: "Recommendation letter",
  employment_letter: "Employment letter",
  salary_evidence: "Salary evidence",
  peer_review: "Peer review evidence",
  critical_role: "Critical role letter",
  other: "Other",
};

/** Cents columns are bigint at the DB; this is the per-file upload cap. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Output kinds the build pipeline can produce. Mirrors
 *  `server/db/schema/enums.ts:outputTypeEnum`. Client-safe alias of the
 *  server-only `OutputType` so analytics events, dashboards, and other
 *  client modules can reference the union without pulling
 *  `server/services/computer/types.ts` (which is `import "server-only"`)
 *  into the bundle. */
export const OUTPUT_TYPES = [
  "personal_statement",
  "petition_letter",
  "recommendation_letter_template",
  "exhibit_index",
  "criteria_analysis",
  "evidence_plan",
  "cover_letter",
  "form_g1145",
  "other",
] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

/** Case workflow statuses. Mirror `server/db/schema/enums.ts:caseStatusEnum`.
 *  Plain TS so client + server share the union without importing
 *  server-only modules. Order is the lifecycle order (intake → archive). */
export const CASE_STATUSES = [
  "intake",
  "documents_pending",
  "extracting",
  "ready_to_build",
  "building",
  "build_failed",
  "draft_ready",
  "in_review",
  "needs_revision",
  "approved",
  "package_ready",
  "delivered",
  "filed",
  "archived",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Discriminator values for `signed_documents.document_kind`. Phase 1
 *  ships only `'contractor_agreement'`. Phase 2 will add applicant-side
 *  kinds (engagement letters, ToS acceptances, etc.) — extend this
 *  array, not the enum file (the column is `text` by design). */
export const SIGNED_DOCUMENT_KINDS = ["contractor_agreement"] as const;

export type SignedDocumentKind = (typeof SIGNED_DOCUMENT_KINDS)[number];
