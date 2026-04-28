import { describe, expect, it } from "vitest";
import { parseEnum, parseEnumParam } from "@/lib/url-params";

const COLORS = ["red", "green", "blue"] as const;
type Color = (typeof COLORS)[number];

describe("parseEnum", () => {
  it("returns the typed value when input matches", () => {
    expect(parseEnum<Color>("green", COLORS)).toBe("green");
  });

  it("returns undefined for non-matching input", () => {
    expect(parseEnum<Color>("yellow", COLORS)).toBeUndefined();
  });

  it("returns undefined for missing input", () => {
    expect(parseEnum<Color>(undefined, COLORS)).toBeUndefined();
  });

  it("does not coerce empty string", () => {
    expect(parseEnum<Color>("", COLORS)).toBeUndefined();
  });

  it("is case-sensitive", () => {
    expect(parseEnum<Color>("Green", COLORS)).toBeUndefined();
    expect(parseEnum<Color>("GREEN", COLORS)).toBeUndefined();
  });
});

describe("parseEnumParam (set form)", () => {
  const set = new Set<string>(COLORS);

  it("returns matched value", () => {
    expect(parseEnumParam<Color>("red", set)).toBe("red");
  });

  it("returns undefined when not in set", () => {
    expect(parseEnumParam<Color>("purple", set)).toBeUndefined();
  });

  it("handles undefined and empty string the same", () => {
    expect(parseEnumParam<Color>(undefined, set)).toBeUndefined();
    expect(parseEnumParam<Color>("", set)).toBeUndefined();
  });
});
