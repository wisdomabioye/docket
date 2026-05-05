import type { DocumentType, VisaType } from "@/lib/constants";

/**
 * Per-visa criteria + required-documents taxonomy for the case
 * Overview / Documents / Package surfaces.
 *
 * Two consumers:
 *   - `case.criteriaCoverage` (Overview "Evidence strength" card +
 *     Package preflight's "N of M criteria met" gate). Exhibit count
 *     per criterion is derived by joining `case_documents.documentType`
 *     to `DOCUMENT_TYPE_TO_CRITERIA`.
 *   - `case.requiredDocsCoverage` (Documents right-rail checklist).
 *     Each required-doc row matches against `documentType` + an
 *     optional `minCount` (e.g. recommendation letters need ≥3).
 *
 * Phase 1 ships **O-1A only**. EB-1A / O-1B etc. fall through to
 * `null` and the calling UI renders an `EmptyState` rather than a
 * grid of zeros — honest scope, no theatre.
 *
 * Adding a new visa: define its `VisaCriteriaConfig` block, add to
 * `CONFIGS`, done. The taxonomy is the only file that changes.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type CriterionStrength = "none" | "weak" | "moderate" | "strong";

export type CriterionDef = {
  /** 1-indexed display code (matches mockup's `.crit-row .code`). */
  code: number;
  name: string;
  description: string;
};

export type RequiredDocDef = {
  /** Stable id used as React key + storage path. */
  key: string;
  label: string;
  /** `case_documents.documentType` to match against. `null` when the
   *  required doc maps to no enum bucket (passport bio page, I-94,
   *  degree certs — all uploaded as `other` today). */
  docType: DocumentType | null;
  /** How many distinct documents are needed to mark this row done.
   *  Defaults to 1; recommendation letters need 3. */
  minCount?: number;
  /** Optional criterion link — surfaces as a "CRIT N" tag in the UI. */
  criterion?: number;
};

export type VisaCriteriaConfig = {
  visa: VisaType;
  criteria: ReadonlyArray<CriterionDef>;
  requiredDocs: ReadonlyArray<RequiredDocDef>;
  /** Minimum criteria with `strength !== "none"` required to qualify.
   *  O-1A: 3 of 8 (or single major prize). Phase 1 enforces the count;
   *  the major-prize escape hatch is admin-judgement. */
  minCriteriaMet: number;
  /** Minimum number of recommender records required before
   *  `completeIntake` will accept the case (rows in
   *  `case_recommenders`). Enforced server-side; the IntakeWizard's
   *  Recommenders section copy mirrors the value. Undefined means
   *  no minimum (visas without explicit guidance). */
  minRecommenders?: number;
};

// ─────────────────────────────────────────────────────────────────────
// O-1A configuration (8 criteria, 14 required documents)
// ─────────────────────────────────────────────────────────────────────

/** O-1A criteria per 8 CFR 214.2(o)(3)(iii). Labels match
 *  `case-overview.html` mockup l. 138-178 (the wireframe compresses a
 *  few category names; we follow the wireframe so attorneys see the
 *  same vocabulary in app + design). */
const O1A_CRITERIA: ReadonlyArray<CriterionDef> = [
  {
    code: 1,
    name: "Prizes & awards",
    description: "Receipt of nationally or internationally recognized awards.",
  },
  {
    code: 2,
    name: "Association membership",
    description: "Membership in associations requiring outstanding achievements.",
  },
  {
    code: 3,
    name: "Published material",
    description: "Published material about the beneficiary in major media.",
  },
  {
    code: 4,
    name: "Scholarly contributions",
    description: "Authorship of scholarly articles in the field.",
  },
  {
    code: 5,
    name: "Peer review",
    description: "Participation as a judge of others' work in the field.",
  },
  {
    code: 6,
    name: "Original research",
    description: "Original scientific or scholarly contributions of major significance.",
  },
  {
    code: 7,
    name: "Critical role",
    description: "Employment in a critical or essential capacity for distinguished organizations.",
  },
  {
    code: 8,
    name: "High remuneration",
    description: "High salary or other remuneration relative to others in the field.",
  },
];

/** O-1A required-documents list. Mirrors `documents.html` mockup
 *  l. 362-372 — the right-rail "Required for O-1A" checklist.
 *
 *  Items with `docType: null` (passport bio, I-94, degree certs,
 *  citation report) currently map to no specific enum bucket; the
 *  attorney uploads them as `other`. They render in the checklist
 *  as "needs manual verification" — the auto-tick path requires a
 *  finer enum + extraction-side classification. */
const O1A_REQUIRED_DOCS: ReadonlyArray<RequiredDocDef> = [
  { key: "cv", label: "Beneficiary CV", docType: "cv_resume" },
  { key: "passport", label: "Passport bio page", docType: null },
  { key: "i94", label: "Current visa / I-94", docType: null },
  { key: "degree", label: "Degree certificates", docType: null, minCount: 1 },
  { key: "employment_letter", label: "Employment letter", docType: "employment_letter" },
  { key: "awards", label: "Awards evidence", docType: "award", criterion: 1 },
  { key: "membership", label: "Membership letters", docType: "membership", criterion: 2 },
  { key: "press", label: "Press / media", docType: "press", criterion: 3 },
  { key: "peer_review", label: "Peer review evidence", docType: "recommendation_letter", criterion: 5 },
  { key: "critical_role", label: "Critical role letter", docType: "employment_letter", criterion: 7 },
  { key: "salary", label: "High salary proof", docType: "salary_evidence", criterion: 8 },
  { key: "publication", label: "Scholarly publication", docType: "publication", criterion: 4 },
  { key: "citation_report", label: "Citation report", docType: null, criterion: 4 },
  { key: "rec_letters", label: "Recommendation letters (3+)", docType: "recommendation_letter", minCount: 3 },
];

const O1A_CONFIG: VisaCriteriaConfig = {
  visa: "O-1A",
  criteria: O1A_CRITERIA,
  requiredDocs: O1A_REQUIRED_DOCS,
  minCriteriaMet: 3,
  // O-1A custom is three letter-writers minimum — mirrored in the
  // `rec_letters` document checklist row above and in the
  // IntakeWizard's empty-state copy.
  minRecommenders: 3,
};

// ─────────────────────────────────────────────────────────────────────
// Document → criteria mapping (used by criteriaCoverage)
// ─────────────────────────────────────────────────────────────────────

/** Heuristic mapping from `documentType` to the criteria that document
 *  typically supports. Used by the Overview Evidence-strength card to
 *  count exhibits per criterion. Phase 1 best-effort; a future stage
 *  may let attorneys manually re-tag exhibits for finer control.
 *
 *  Empty array = the document type doesn't directly evidence any
 *  criterion (e.g. `cv_resume` is identity / `other` is unclassified).
 *  Both still count for required-docs coverage but contribute zero to
 *  criteria strength. */
const DOCUMENT_TYPE_TO_CRITERIA: Readonly<
  Record<DocumentType, ReadonlyArray<number>>
> = {
  cv_resume: [],
  publication: [4, 6],
  patent: [6],
  press: [3],
  award: [1],
  membership: [2],
  recommendation_letter: [5, 7],
  employment_letter: [7],
  salary_evidence: [8],
  other: [],
};

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

const CONFIGS: Partial<Record<VisaType, VisaCriteriaConfig>> = {
  "O-1A": O1A_CONFIG,
};

/** Look up the criteria + required-docs config for a visa. Returns
 *  `null` for unsupported visa types so callers (UI + service) render
 *  an `EmptyState` rather than a broken grid. */
export function visaCriteriaConfig(visa: string): VisaCriteriaConfig | null {
  return CONFIGS[visa as VisaType] ?? null;
}

/** Convenience accessor for callers that only need the criteria list
 *  (Overview Evidence-strength card, Package preflight). */
export function criteriaFor(visa: string): ReadonlyArray<CriterionDef> {
  return visaCriteriaConfig(visa)?.criteria ?? [];
}

/** Convenience accessor for the required-docs list (Documents right
 *  rail). */
export function requiredDocsFor(visa: string): ReadonlyArray<RequiredDocDef> {
  return visaCriteriaConfig(visa)?.requiredDocs ?? [];
}

/** Maps an uploaded document's type to the criteria it typically
 *  supports. Used by `case.criteriaCoverage` to attribute exhibits to
 *  criteria. */
export function criteriaForDocumentType(
  type: DocumentType,
): ReadonlyArray<number> {
  return DOCUMENT_TYPE_TO_CRITERIA[type];
}

/** Single source for the strength label derived from exhibit count.
 *  Tweak thresholds here once; coverage card + preflight gate both
 *  read the result. */
export function strengthFor(exhibitCount: number): CriterionStrength {
  if (exhibitCount === 0) return "none";
  if (exhibitCount === 1) return "weak";
  if (exhibitCount === 2) return "moderate";
  return "strong";
}

/** Per-case storage cap (bytes). Exposed here so the Documents
 *  StorageCard + the upload mutation share one constant. Mockup
 *  shows 500 MB; matches CLAUDE.md §8 ("500 MB per case"). */
export const PER_CASE_STORAGE_BYTES = 500 * 1024 * 1024;
