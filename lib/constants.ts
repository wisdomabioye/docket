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
  other: "Other",
};

/** Cents columns are bigint at the DB; this is the per-file upload cap. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
