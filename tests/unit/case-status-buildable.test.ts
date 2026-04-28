import { describe, expect, it } from "vitest";
import {
  BUILDABLE_STATUSES,
  CASE_STATUSES,
  canRequestBuild,
  type CaseStatus,
} from "@/lib/case-status";

/**
 * Truth table for `canRequestBuild`. Adding a new status to the enum
 * forces a new row here (TypeScript narrows `CaseStatus`). The intent:
 * builds are ONLY requestable from `ready_to_build` (post-extraction
 * happy path) and `build_failed` (retry path). Pre-extraction statuses
 * have nothing to build with; post-build statuses are either in flight
 * or already complete.
 */

const EXPECTED: Record<CaseStatus, boolean> = {
  intake: false,
  documents_pending: false,
  extracting: false,
  ready_to_build: true,
  building: false,
  build_failed: true,
  draft_ready: false,
  in_review: false,
  needs_revision: false,
  approved: false,
  package_ready: false,
  delivered: false,
  filed: false,
  archived: false,
};

describe("canRequestBuild", () => {
  for (const status of CASE_STATUSES) {
    const expected = EXPECTED[status];
    it(`${status} → ${expected}`, () => {
      expect(canRequestBuild(status)).toBe(expected);
    });
  }

  it("BUILDABLE_STATUSES contains exactly the truthy entries", () => {
    const fromTable = (
      Object.keys(EXPECTED) as readonly CaseStatus[]
    ).filter((s) => EXPECTED[s]);
    expect([...BUILDABLE_STATUSES].sort()).toEqual(fromTable.sort());
  });
});
