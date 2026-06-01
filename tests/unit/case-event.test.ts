import { describe, expect, it } from "vitest";
import { describeCaseEvent } from "@/lib/case-event";

describe("describeCaseEvent", () => {
  it("maps every real case_events type to a non-token sentence", () => {
    // The 10 types actually emitted across server/ (grep `eventType:`).
    const types = [
      "case.created",
      "case.beneficiary_updated",
      "case.status_changed",
      "case.fee_logged",
      "document.uploaded",
      "document.deleted",
      "recommender.added",
      "recommender.removed",
      "recommender.updated",
      "recommender.reordered",
    ];
    for (const t of types) {
      const s = describeCaseEvent(t, "user");
      // A handled type must NOT fall through to the raw-token default.
      expect(s, t).not.toContain(t);
      expect(s.length, t).toBeGreaterThan(0);
    }
  });

  it("uses the right subject per actor", () => {
    expect(describeCaseEvent("case.created", "user")).toBe("You created the case");
    expect(describeCaseEvent("document.uploaded", "computer")).toBe(
      "Docket uploaded a document",
    );
    expect(describeCaseEvent("case.fee_logged", "system")).toBe(
      "System logged the case fee",
    );
  });

  it("status_changed reads details.to when present", () => {
    expect(
      describeCaseEvent("case.status_changed", "system", { to: "ready_to_build" }),
    ).toBe("Status changed to ready to build");
  });

  it("status_changed falls back without details", () => {
    expect(describeCaseEvent("case.status_changed", "user")).toBe(
      "You changed the case status",
    );
  });

  it("status_changed ignores a non-string `to`", () => {
    expect(
      describeCaseEvent("case.status_changed", "user", { to: 42 }),
    ).toBe("You changed the case status");
  });

  it("unknown type surfaces the raw token (visibility, not silent drop)", () => {
    expect(describeCaseEvent("future.thing", "user")).toBe("You · future.thing");
  });
});
