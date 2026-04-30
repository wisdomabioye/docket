import type { CaseStatus } from "@/lib/constants";

/**
 * Attorney-facing pipeline mapping. The DB enum has 14 case statuses
 * (`server/db/schema/enums.ts:caseStatusEnum`); the dashboard sidebar
 * groups them into 5 buckets that mirror the mockup
 * (`dashboard.html .side`). Single source of truth so:
 *   - `me.pipelineCounts` (server) and the dashboard `?stage=…` filter
 *     (server) agree on which statuses belong to which bucket.
 *   - The `AttorneySidebar` href + the dashboard `searchParams` parser
 *     share the same vocabulary (`PipelineKey`).
 *   - A future enum addition only updates this file, not three call
 *     sites.
 */

export type PipelineKey =
  | "intake"
  | "documents"
  | "drafting"
  | "review"
  | "filed";

export const PIPELINE_KEYS: ReadonlyArray<PipelineKey> = [
  "intake",
  "documents",
  "drafting",
  "review",
  "filed",
];

/** Status arrays per bucket. Typed against the schema enum so a status
 *  rename causes a typecheck failure (vs. a silent miss). */
export const PIPELINE_STATUSES: Record<PipelineKey, ReadonlyArray<CaseStatus>> = {
  intake: ["intake"],
  documents: ["documents_pending", "extracting", "ready_to_build"],
  drafting: ["building", "build_failed", "draft_ready"],
  review: ["in_review", "needs_revision", "approved"],
  filed: ["package_ready", "delivered", "filed"],
};

/** Validate + narrow an unknown query string to a `PipelineKey`.
 *  Returns `null` for absent / unrecognised values so the dashboard can
 *  fall through to "all stages" without throwing. */
export function parsePipelineKey(value: unknown): PipelineKey | null {
  if (typeof value !== "string") return null;
  return (PIPELINE_KEYS as ReadonlyArray<string>).includes(value)
    ? (value as PipelineKey)
    : null;
}
