// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shortCaseId, shortCaseLabel } from "@/lib/case-id";

describe("shortCaseId", () => {
  it("returns CASE- prefix + first 4 hex chars uppercased", () => {
    expect(shortCaseId("11111111-2222-3333-4444-555555555555")).toBe(
      "CASE-1111",
    );
    expect(shortCaseId("abcdef00-0000-0000-0000-000000000000")).toBe(
      "CASE-ABCD",
    );
  });
});

describe("shortCaseLabel", () => {
  it("returns 'Case ' + first 4 hex chars uppercased", () => {
    expect(shortCaseLabel("11111111-2222-3333-4444-555555555555")).toBe(
      "Case 1111",
    );
    expect(shortCaseLabel("abcdef00-0000-0000-0000-000000000000")).toBe(
      "Case ABCD",
    );
  });
});
