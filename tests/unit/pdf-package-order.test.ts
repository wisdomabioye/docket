import { describe, expect, it } from "vitest";
import { packageKeyFor, packageOrderRank } from "@/server/services/pdf/package";

/**
 * `packageOrderRank` defines the canonical filing order for the
 * package PDF. Locked behavior:
 *   - Listed types: petition_letter < personal_statement <
 *     recommendation_letter_template < criteria_analysis <
 *     exhibit_index.
 *   - `evidence_plan` is internal scaffolding (see
 *     `INTERNAL_OUTPUT_TYPES`) and intentionally NOT in the canonical
 *     order — it ranks with the unlisted-fallback sentinel.
 *   - Unlisted types (`cover_letter`, `form_g1145`, `other`,
 *     `evidence_plan`) fall through to a single sentinel rank,
 *     sorted last.
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

  it("ranks criteria_analysis before exhibit_index", () => {
    expect(packageOrderRank("criteria_analysis")).toBeLessThan(
      packageOrderRank("exhibit_index"),
    );
  });

  it("falls through to a sentinel for unlisted types (cover_letter, form_g1145, other, evidence_plan)", () => {
    const sentinel = packageOrderRank("cover_letter");
    expect(packageOrderRank("form_g1145")).toBe(sentinel);
    expect(packageOrderRank("other")).toBe(sentinel);
    // `evidence_plan` is internal — it has no canonical rank and
    // shares the unlisted sentinel.
    expect(packageOrderRank("evidence_plan")).toBe(sentinel);
    // Unlisted types sort AFTER every listed type.
    expect(sentinel).toBeGreaterThan(packageOrderRank("exhibit_index"));
  });
});

/**
 * `packageKeyFor` is the byte-for-byte contract between three call
 * sites: `case.setPackageOrder` (persists keys), `PackageAssemblyCard`
 * (DnD ids), and `compileFullPackagePdf` (sort lookup). A drift here
 * silently breaks the persisted ordering.
 */
describe("packageKeyFor", () => {
  it("formats unsubgrouped outputs as the bare outputType", () => {
    expect(
      packageKeyFor({ outputType: "petition_letter", subgroupKey: null }),
    ).toBe("petition_letter");
  });

  it("joins outputType and subgroupKey with a single colon", () => {
    expect(
      packageKeyFor({
        outputType: "recommendation_letter_template",
        subgroupKey: "rec-a",
      }),
    ).toBe("recommendation_letter_template:rec-a");
  });

  it("treats empty-string subgroupKey as unsubgrouped (truthy check)", () => {
    expect(
      packageKeyFor({ outputType: "petition_letter", subgroupKey: "" }),
    ).toBe("petition_letter");
  });
});
