import { describe, expect, it } from "vitest";
import { buildEtaMinutes } from "@/server/services/email/notifications/eta";

/**
 * `buildEtaMinutes` clamps a doc-count derived ETA into the user-visible
 * 5..30 minute window. The exact baseline + slope is intentionally not
 * locked here (it's a heuristic); only the floor, ceiling, and
 * monotonicity that the email body depends on.
 */
describe("buildEtaMinutes", () => {
  it("returns at least 5 for zero docs", () => {
    expect(buildEtaMinutes(0)).toBe(5);
  });

  it("returns at most 30 even for absurdly many docs", () => {
    expect(buildEtaMinutes(10_000)).toBe(30);
  });

  it("is non-decreasing in document count", () => {
    let prev = buildEtaMinutes(0);
    for (let n = 1; n <= 60; n++) {
      const eta = buildEtaMinutes(n);
      expect(eta).toBeGreaterThanOrEqual(prev);
      prev = eta;
    }
  });

  it("returns an integer (so the email reads cleanly)", () => {
    for (const n of [0, 1, 7, 13, 25, 60, 1000]) {
      const eta = buildEtaMinutes(n);
      expect(Number.isInteger(eta)).toBe(true);
    }
  });
});
