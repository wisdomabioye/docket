import { describe, expect, it } from "vitest";
import { packageOrderRank } from "@/server/services/pdf/package";

/**
 * `packageOrderRank` defines the canonical filing order for the
 * package PDF. Locked behavior:
 *   - Listed types: petition_letter < personal_statement <
 *     recommendation_letter_template < criteria_analysis <
 *     evidence_plan < exhibit_index.
 *   - Unlisted types (`cover_letter`, `form_g1145`, `other`) fall
 *     through to a single sentinel rank, sorted last.
 */
describe("packageOrderRank", () => {
  it("ranks petition_letter first", () => {
    expect(packageOrderRank("petition_letter")).toBe(0);
  });

  it("ranks personal_statement before recommendation_letter_template", () => {
    expect(packageOrderRank("personal_statement")).toBeLessThan(
      packageOrderRank("recommendation_letter_template"),
    );
  });

  it("ranks recommendation_letter_template before criteria_analysis", () => {
    expect(packageOrderRank("recommendation_letter_template")).toBeLessThan(
      packageOrderRank("criteria_analysis"),
    );
  });

  it("ranks criteria_analysis before evidence_plan", () => {
    expect(packageOrderRank("criteria_analysis")).toBeLessThan(
      packageOrderRank("evidence_plan"),
    );
  });

  it("ranks evidence_plan before exhibit_index", () => {
    expect(packageOrderRank("evidence_plan")).toBeLessThan(
      packageOrderRank("exhibit_index"),
    );
  });

  it("falls through to a sentinel for unlisted types (cover_letter, form_g1145, other)", () => {
    const sentinel = packageOrderRank("cover_letter");
    expect(packageOrderRank("form_g1145")).toBe(sentinel);
    expect(packageOrderRank("other")).toBe(sentinel);
    // Unlisted types sort AFTER every listed type.
    expect(sentinel).toBeGreaterThan(packageOrderRank("exhibit_index"));
  });
});
