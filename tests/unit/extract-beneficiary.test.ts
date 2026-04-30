// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractBeneficiaryFullName } from "@/server/db/helpers";

describe("extractBeneficiaryFullName", () => {
  it("extracts a non-empty fullName from a JSONB-shaped object", () => {
    expect(
      extractBeneficiaryFullName({ fullName: "Maria Gonzalez" }),
    ).toBe("Maria Gonzalez");
  });

  it("trims surrounding whitespace", () => {
    expect(extractBeneficiaryFullName({ fullName: "  Maria  " })).toBe("Maria");
  });

  it("returns null for an empty / whitespace-only fullName", () => {
    expect(extractBeneficiaryFullName({ fullName: "" })).toBeNull();
    expect(extractBeneficiaryFullName({ fullName: "   " })).toBeNull();
  });

  it("returns null when the field is missing", () => {
    expect(extractBeneficiaryFullName({})).toBeNull();
    expect(extractBeneficiaryFullName({ otherField: "x" })).toBeNull();
  });

  it("returns null when the field is not a string", () => {
    expect(extractBeneficiaryFullName({ fullName: 42 })).toBeNull();
    expect(extractBeneficiaryFullName({ fullName: null })).toBeNull();
    expect(extractBeneficiaryFullName({ fullName: { x: 1 } })).toBeNull();
  });

  it("returns null for non-object inputs", () => {
    expect(extractBeneficiaryFullName(null)).toBeNull();
    expect(extractBeneficiaryFullName(undefined)).toBeNull();
    expect(extractBeneficiaryFullName("Maria")).toBeNull();
    expect(extractBeneficiaryFullName(42)).toBeNull();
  });
});
