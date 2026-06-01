import { isInternalOutputType } from "@/lib/output-types";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Pure review-queue math for the output editor (Stage 13). Kept out of
 * the 800-line `OutputDetailPanel` so it's unit-testable and so the
 * "what counts" rule lives in one place.
 *
 * Counts the SAME set as the grid and the approvals tally: current,
 * non-deleted (the caller passes `output.list`, which is already current
 * + non-deleted), and non-INTERNAL (`evidence_plan` is excluded). If this
 * filter drifts from `summarizeOutputApprovals`, the editor's "K awaiting"
 * would disagree with the dashboard — so it mirrors it exactly.
 */

export type ReviewQueueItem = {
  id: string;
  outputType: OutputType;
  attorneyApproved: boolean;
};

export type ReviewQueue = {
  /** Reviewable outputs (non-internal). */
  total: number;
  /** How many still need attorney approval. */
  awaiting: number;
  /** 1-based position of the current output, or null if it's not in the
   *  reviewable set (e.g. viewing an internal output). */
  position: number | null;
  /** The next output that still needs review, excluding the current one;
   *  null when none remain (→ show the package handoff instead). */
  nextUnreviewedId: string | null;
};

export function computeReviewQueue(
  items: ReadonlyArray<ReviewQueueItem>,
  currentId: string,
): ReviewQueue {
  const reviewable = items.filter((it) => !isInternalOutputType(it.outputType));
  const total = reviewable.length;
  const approved = reviewable.filter((it) => it.attorneyApproved).length;
  const currentIdx = reviewable.findIndex((it) => it.id === currentId);
  const next = reviewable.find(
    (it) => !it.attorneyApproved && it.id !== currentId,
  );
  return {
    total,
    awaiting: total - approved,
    position: currentIdx >= 0 ? currentIdx + 1 : null,
    nextUnreviewedId: next?.id ?? null,
  };
}
