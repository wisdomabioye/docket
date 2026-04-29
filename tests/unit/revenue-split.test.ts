// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  computeRevenueSplit,
  maskBeneficiaryName,
  invoiceLineDescription,
  DOCKET_SHARE_BPS,
} from "@/server/services/stripe/split";

/**
 * Boundary-case unit tests for the 15/85 split. Floor-on-docket means
 * fractions of a cent always go to the attorney, never to Docket.
 * Reconciliation depends on `attorney + docket === fee` exactly.
 */

describe("computeRevenueSplit — basic algebra", () => {
  it("zero fee yields all-zero split", () => {
    expect(computeRevenueSplit(0)).toEqual({
      feeCents: 0,
      docketShareCents: 0,
      attorneyShareCents: 0,
    });
  });

  it("$1.00 (100 cents) → 15 / 85", () => {
    expect(computeRevenueSplit(100)).toEqual({
      feeCents: 100,
      docketShareCents: 15,
      attorneyShareCents: 85,
    });
  });

  it("$10,000.00 (1_000_000 cents) → 1500 / 8500 dollars", () => {
    expect(computeRevenueSplit(1_000_000)).toEqual({
      feeCents: 1_000_000,
      docketShareCents: 150_000,
      attorneyShareCents: 850_000,
    });
  });

  it("$0.01 (1 cent) floors docket to 0; attorney keeps the penny", () => {
    expect(computeRevenueSplit(1)).toEqual({
      feeCents: 1,
      docketShareCents: 0,
      attorneyShareCents: 1,
    });
  });
});

describe("computeRevenueSplit — invariants across many values", () => {
  it("attorney + docket always equals fee, exactly", () => {
    for (const fee of [0, 1, 7, 99, 100, 333, 999, 1_000, 12_345, 99_999, 1_234_567, 9_999_999]) {
      const r = computeRevenueSplit(fee);
      expect(r.attorneyShareCents + r.docketShareCents).toBe(fee);
    }
  });

  it("docket is floor of (fee * 15%) — never rounds up", () => {
    for (const fee of [3, 7, 33, 199, 333, 12_345]) {
      const r = computeRevenueSplit(fee);
      const expected = Math.floor((fee * DOCKET_SHARE_BPS) / 10_000);
      expect(r.docketShareCents).toBe(expected);
      // The attorney never receives less than 85% (modulo rounding floor on docket).
      expect(r.attorneyShareCents).toBeGreaterThanOrEqual(fee - expected);
    }
  });
});

describe("computeRevenueSplit — error cases", () => {
  it("throws on negative fee", () => {
    expect(() => computeRevenueSplit(-1)).toThrow(/non-negative/i);
  });

  it("throws on non-integer fee", () => {
    expect(() => computeRevenueSplit(1.5)).toThrow(/finite integer/i);
  });

  it("throws on NaN", () => {
    expect(() => computeRevenueSplit(Number.NaN)).toThrow(/finite/i);
  });

  it("throws on Infinity", () => {
    expect(() => computeRevenueSplit(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });
});

describe("maskBeneficiaryName", () => {
  it("two-word name → two initials, period-separated, period-suffixed", () => {
    expect(maskBeneficiaryName("Maria Gonzalez")).toBe("M.G.");
  });

  it("single-word name → one initial", () => {
    expect(maskBeneficiaryName("Madonna")).toBe("M.");
  });

  it("multi-particle name → every word contributes an initial", () => {
    expect(maskBeneficiaryName("Maria de la Cruz Gonzalez")).toBe("M.D.L.C.G.");
  });

  it("empty / whitespace / null → 'Beneficiary' placeholder", () => {
    expect(maskBeneficiaryName("")).toBe("Beneficiary");
    expect(maskBeneficiaryName("   ")).toBe("Beneficiary");
    expect(maskBeneficiaryName(null)).toBe("Beneficiary");
    expect(maskBeneficiaryName(undefined)).toBe("Beneficiary");
  });

  it("collapses multiple spaces between words", () => {
    expect(maskBeneficiaryName("Jane    Doe")).toBe("J.D.");
  });

  it("uppercases lowercase initials", () => {
    expect(maskBeneficiaryName("jane doe")).toBe("J.D.");
  });
});

describe("invoiceLineDescription", () => {
  it("formats visa-type + masked beneficiary", () => {
    expect(
      invoiceLineDescription({
        visaType: "O-1A",
        beneficiaryFullName: "Maria Gonzalez",
      }),
    ).toBe("O-1A · Beneficiary M.G.");
  });

  it("uses placeholder for unnamed beneficiary", () => {
    expect(
      invoiceLineDescription({
        visaType: "EB-1A",
        beneficiaryFullName: null,
      }),
    ).toBe("EB-1A · Beneficiary Beneficiary");
  });
});
