import { describe, expect, it } from "vitest";
import { computeReviewQueue, type ReviewQueueItem } from "@/lib/review-queue";

/** Build a list item. `t` defaults to a reviewable prose type. */
function item(
  id: string,
  attorneyApproved: boolean,
  outputType: ReviewQueueItem["outputType"] = "personal_statement",
): ReviewQueueItem {
  return { id, attorneyApproved, outputType };
}

describe("computeReviewQueue", () => {
  it("counts reviewable totals and awaiting", () => {
    const q = computeReviewQueue(
      [item("a", true), item("b", false), item("c", false)],
      "a",
    );
    expect(q.total).toBe(3);
    expect(q.awaiting).toBe(2);
    expect(q.position).toBe(1);
  });

  it("excludes internal outputs (evidence_plan) from the count", () => {
    const q = computeReviewQueue(
      [item("a", false), item("plan", false, "evidence_plan"), item("b", true)],
      "a",
    );
    // evidence_plan is internal — not part of the review queue.
    expect(q.total).toBe(2);
    expect(q.awaiting).toBe(1);
  });

  it("next unreviewed excludes the current output", () => {
    const q = computeReviewQueue(
      [item("a", false), item("b", false), item("c", true)],
      "a",
    );
    // 'a' is current + unreviewed, but next must skip it → 'b'.
    expect(q.nextUnreviewedId).toBe("b");
  });

  it("returns next in list order", () => {
    const q = computeReviewQueue(
      [item("a", true), item("b", true), item("c", false), item("d", false)],
      "a",
    );
    expect(q.nextUnreviewedId).toBe("c");
  });

  it("last unreviewed = current → no next (handoff to package)", () => {
    const q = computeReviewQueue(
      [item("a", true), item("b", true), item("c", false)],
      "c",
    );
    expect(q.nextUnreviewedId).toBeNull();
    expect(q.awaiting).toBe(1);
  });

  it("all approved → awaiting 0, no next", () => {
    const q = computeReviewQueue([item("a", true), item("b", true)], "a");
    expect(q.awaiting).toBe(0);
    expect(q.nextUnreviewedId).toBeNull();
  });

  it("position null when current is not in the reviewable set", () => {
    const q = computeReviewQueue(
      [item("a", false), item("plan", false, "evidence_plan")],
      "plan",
    );
    expect(q.position).toBeNull();
  });

  it("excludes MULTIPLE internal outputs from the count", () => {
    const q = computeReviewQueue(
      [
        item("a", false),
        item("p1", false, "evidence_plan"),
        item("b", true),
        item("p2", false, "evidence_plan"),
      ],
      "a",
    );
    expect(q.total).toBe(2);
    expect(q.awaiting).toBe(1);
    expect(q.nextUnreviewedId).toBeNull(); // 'a' is current, 'b' approved
  });

  it("empty list → zeros and no next", () => {
    const q = computeReviewQueue([], "x");
    expect(q).toEqual({
      total: 0,
      awaiting: 0,
      position: null,
      nextUnreviewedId: null,
    });
  });
});
