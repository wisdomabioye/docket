import { describe, expect, it } from "vitest";
import { ATTORNEY_STATUSES } from "@/lib/constants";
import { CASE_STATUSES } from "@/lib/case-status";
import {
  attorneyStatusVariant,
  caseStatusVariant,
  waitlistApprovalVariant,
} from "@/lib/status-style";

/**
 * The variant maps are `Record<Enum, BadgeVariant>` — TypeScript already
 * fails the build if a new enum value isn't mapped. These tests are the
 * runtime safety net: they fail loudly on the rare path where a renamed
 * enum value slips through (e.g. `as` casts hiding a missing key).
 */

describe("attorneyStatusVariant", () => {
  it("maps every AttorneyStatus value", () => {
    for (const s of ATTORNEY_STATUSES) {
      expect(attorneyStatusVariant[s]).toBeDefined();
    }
  });
});

describe("caseStatusVariant", () => {
  it("maps every CaseStatus value", () => {
    for (const s of CASE_STATUSES) {
      expect(caseStatusVariant[s]).toBeDefined();
    }
  });
});

describe("waitlistApprovalVariant", () => {
  it("returns success for approved", () => {
    expect(waitlistApprovalVariant(true)).toBe("success");
  });

  it("returns warning for pending", () => {
    expect(waitlistApprovalVariant(false)).toBe("warning");
  });
});
