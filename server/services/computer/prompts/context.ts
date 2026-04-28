import "server-only";
import type { BeneficiaryData } from "@/server/db/schema/zod";
import type { EvidencePlan } from "@/server/db/schema/zod";
import type { VisaType } from "@/lib/constants";

/**
 * Snapshot of everything a case-build needs to construct its prompts.
 * Built once by the parent Inngest function (`loadBuildContext`) at the
 * start of the pipeline; passed to each sub-function as event data so
 * sub-functions don't re-query the DB and can detect mid-build mutation
 * (compare `snapshotAt` against `cases.updated_at`).
 *
 * Lives here (not in `server/services/cases/`) because both producers
 * (the parent job) and consumers (prompt builders) need to import from
 * a neutral spot — putting it in the case service would force the
 * computer module to import from cases.
 */
export type BuildContext = {
  /** Case PK — for prompt stamping + telemetry. */
  caseId: string;
  /** ISO timestamp of `cases.updated_at` at build start. Sub-functions
   *  re-read `cases.updated_at` and abort if it's grown (intake mutated
   *  mid-build, recommender added/removed, etc.). */
  snapshotAt: string;
  visaType: VisaType;
  /** Beneficiary data captured at intake. Optional fields may be absent. */
  beneficiary: BeneficiaryData;
  /** Per-document extracted text. Truncated to first 50k chars per doc;
   *  `truncated = true` when the original was longer. */
  documents: readonly BuildContextDocument[];
  /** Evidence-plan output — populated by the evidence-plan sub-function
   *  before the personal-statement / petition-letter / criteria-analysis
   *  jobs run. `null` for the evidence-plan call itself. */
  evidencePlan: EvidencePlan | null;
  /** Recommender list captured at intake. Each becomes a fan-out target
   *  for the recommendation-letter sub-function. */
  recommenders: readonly Recommender[];
};

export type BuildContextDocument = {
  id: string;
  /** `documentTypeEnum` value — `cv_resume`, `publication`, etc. */
  type: string;
  originalFilename: string;
  /** First 50k chars of `case_documents.extracted_text`. Empty string
   *  when extraction failed (sub-function decides whether to skip). */
  extractedText: string;
  truncated: boolean;
};

export type Recommender = {
  /** Stable id within the build (used for fan-out idempotency). */
  id: string;
  fullName: string;
  /** e.g. "Professor", "Director, Acme Labs" */
  role: string;
  /** Free-form: "PhD advisor", "Co-author on N papers", etc. */
  relationship: string;
  /** Letter-template guidance from the attorney; null when not provided. */
  guidance: string | null;
};

/** Return shape of every prompt builder. Composes into `ComputerInput`
 *  by adding a `metadata` block in the calling sub-function. */
export type PromptSpec = {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  searchPolicy?:
    | { mode: "disabled" }
    | { mode: "web"; domainAllowlist?: readonly string[] }
    | { mode: "academic" };
  maxTokens?: number;
};
