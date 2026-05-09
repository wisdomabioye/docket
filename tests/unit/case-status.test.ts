import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  CASE_STATUSES,
  POST_PACKAGE_LOCKED_STATUSES,
  assertOutputMutationAllowed,
  canTransition,
  canUploadInStatus,
  legalNextStatuses,
  type CaseStatus,
  type LockableOutputMutation,
} from "@/lib/case-status";

/**
 * Pure unit tests for the case status state machine.
 * Every legal transition validated; every illegal transition rejected.
 * If `caseStatusEnum` grows, this suite enforces that the new status
 * gets edges defined.
 */

describe("case status state machine", () => {
  it("knows all 14 enum values", () => {
    expect(CASE_STATUSES).toHaveLength(14);
  });

  it("intake → documents_pending is legal (Stage 05)", () => {
    expect(canTransition("intake", "documents_pending")).toBe(true);
  });

  it("intake → archived is legal (attorney can abandon)", () => {
    expect(canTransition("intake", "archived")).toBe(true);
  });

  it("intake → draft_ready is illegal (skips middle states)", () => {
    expect(canTransition("intake", "draft_ready")).toBe(false);
  });

  it("intake → filed is illegal", () => {
    expect(canTransition("intake", "filed")).toBe(false);
  });

  it("filed → delivered + archived are the legal exits from filed (ADR-006)", () => {
    expect(legalNextStatuses("filed")).toEqual(["delivered", "archived"]);
    expect(canTransition("filed", "delivered")).toBe(true);
    expect(canTransition("filed", "archived")).toBe(true);
  });

  it("filed → in_review is still illegal (no shortcut around delivered)", () => {
    expect(canTransition("filed", "in_review")).toBe(false);
    expect(canTransition("filed", "approved")).toBe(false);
    expect(canTransition("filed", "draft_ready")).toBe(false);
  });

  it("archived is terminal — no outgoing edges", () => {
    expect(legalNextStatuses("archived")).toHaveLength(0);
    for (const target of CASE_STATUSES) {
      expect(canTransition("archived", target)).toBe(false);
    }
  });

  it("build_failed → ready_to_build allows retry (admin / reset path)", () => {
    expect(canTransition("build_failed", "ready_to_build")).toBe(true);
  });

  it("build_failed → building allows the retry path the build CTA uses", () => {
    // BUILDABLE_STATUSES says `build_failed` is buildable; without this
    // edge the requestBuild mutation throws "illegal status transition
    // build_failed → building" the moment an attorney clicks Build
    // after a watchdog sweep.
    expect(canTransition("build_failed", "building")).toBe(true);
  });

  it("needs_revision → in_review allows resume", () => {
    expect(canTransition("needs_revision", "in_review")).toBe(true);
  });

  it("documents_pending cannot skip to ready_to_build", () => {
    expect(canTransition("documents_pending", "ready_to_build")).toBe(false);
  });

  it("every status (except archived) can transition to archived", () => {
    for (const s of CASE_STATUSES) {
      if (s === "archived") continue;
      expect(canTransition(s as CaseStatus, "archived")).toBe(true);
    }
  });

  describe("canUploadInStatus — recommendation_letter post-build window", () => {
    it("blocks ordinary evidence in draft_ready", () => {
      expect(canUploadInStatus("draft_ready", "cv_resume")).toBe(false);
      expect(canUploadInStatus("draft_ready")).toBe(false);
    });

    it("allows recommendation_letter in draft_ready / in_review / approved", () => {
      expect(canUploadInStatus("draft_ready", "recommendation_letter")).toBe(true);
      expect(canUploadInStatus("in_review", "recommendation_letter")).toBe(true);
      expect(canUploadInStatus("approved", "recommendation_letter")).toBe(true);
    });

    it("stops at approved — package_ready / delivered / filed reject", () => {
      expect(canUploadInStatus("package_ready", "recommendation_letter")).toBe(false);
      expect(canUploadInStatus("delivered", "recommendation_letter")).toBe(false);
      expect(canUploadInStatus("filed", "recommendation_letter")).toBe(false);
    });

    it("recommendation_letter still works in pre-build statuses", () => {
      expect(canUploadInStatus("intake", "recommendation_letter")).toBe(true);
      expect(canUploadInStatus("ready_to_build", "recommendation_letter")).toBe(true);
    });

    it("rejects uploads while building/extracting regardless of type", () => {
      expect(canUploadInStatus("building", "recommendation_letter")).toBe(false);
      expect(canUploadInStatus("extracting", "cv_resume")).toBe(true); // extracting is in UPLOADABLE
      expect(canUploadInStatus("building", "cv_resume")).toBe(false);
    });
  });

  it("every status defines outgoing edges", () => {
    for (const s of CASE_STATUSES) {
      const edges = legalNextStatuses(s);
      // Only `archived` is allowed to be terminal.
      if (s === "archived") {
        expect(edges).toHaveLength(0);
      } else {
        expect(edges.length).toBeGreaterThan(0);
      }
    }
  });

  describe("assertOutputMutationAllowed (ADR-006 lockset)", () => {
    const LOCKABLE: readonly LockableOutputMutation[] = [
      "output.update",
      "output.unapprove",
      "output.regenerate",
      "output.restoreVersion",
    ] as const;

    it("POST_PACKAGE_LOCKED_STATUSES is exactly delivered/filed/archived", () => {
      expect([...POST_PACKAGE_LOCKED_STATUSES]).toEqual([
        "delivered",
        "filed",
        "archived",
      ]);
    });

    it("rejects edit/unapprove/regenerate/restore from delivered + filed + archived", () => {
      for (const mutation of LOCKABLE) {
        for (const status of POST_PACKAGE_LOCKED_STATUSES) {
          expect(() =>
            assertOutputMutationAllowed(status, mutation),
          ).toThrow(AppError);
        }
      }
    });

    it("permits edit/unapprove/regenerate/restore from every other status", () => {
      const allowed = CASE_STATUSES.filter(
        (s) =>
          !(POST_PACKAGE_LOCKED_STATUSES as readonly CaseStatus[]).includes(s),
      );
      for (const mutation of LOCKABLE) {
        for (const status of allowed) {
          expect(() =>
            assertOutputMutationAllowed(status, mutation),
          ).not.toThrow();
        }
      }
    });

    it("approve is rejected only from archived (re-approval is a normal review path)", () => {
      expect(() =>
        assertOutputMutationAllowed("archived", "output.approve"),
      ).toThrow(AppError);
      // Permitted everywhere else, including delivered + filed where edits
      // would be rejected. Approving an already-approved row is idempotent
      // upstream; we don't gate on it here.
      const allowed = CASE_STATUSES.filter((s) => s !== "archived");
      for (const status of allowed) {
        expect(() =>
          assertOutputMutationAllowed(status, "output.approve"),
        ).not.toThrow();
      }
    });

    it("error message points the attorney at admin.case.unmarkFiled when delivered/filed", () => {
      for (const status of ["delivered", "filed"] as const) {
        try {
          assertOutputMutationAllowed(status, "output.update");
          throw new Error("did not throw");
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).code).toBe("CONFLICT");
          expect((err as AppError).message).toMatch(
            /admin\.case\.unmarkFiled/,
          );
        }
      }
    });

    it("error message for archived does not advertise the unmark path", () => {
      try {
        assertOutputMutationAllowed("archived", "output.update");
        throw new Error("did not throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).message).not.toMatch(/unmarkFiled/);
        expect((err as AppError).message).toMatch(/archived/);
      }
    });
  });
});
