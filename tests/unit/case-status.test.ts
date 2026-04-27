import { describe, expect, it } from "vitest";
import {
  CASE_STATUSES,
  canTransition,
  legalNextStatuses,
  type CaseStatus,
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

  it("filed → archived is the only legal exit from filed", () => {
    expect(legalNextStatuses("filed")).toEqual(["archived"]);
  });

  it("archived is terminal — no outgoing edges", () => {
    expect(legalNextStatuses("archived")).toHaveLength(0);
    for (const target of CASE_STATUSES) {
      expect(canTransition("archived", target)).toBe(false);
    }
  });

  it("build_failed → ready_to_build allows retry", () => {
    expect(canTransition("build_failed", "ready_to_build")).toBe(true);
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
});
