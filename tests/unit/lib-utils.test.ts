import { describe, expect, it } from "vitest";
import { cn, isoOffsetYears, isoToday } from "@/lib/utils";
import { AppError, httpStatusForCode, isAppError } from "@/lib/errors";

describe("cn()", () => {
  it("merges plain strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("resolves conflicting Tailwind utilities", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("filters falsy entries", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });
});

describe("AppError", () => {
  it("preserves code + message", () => {
    const e = new AppError("NOT_FOUND", "missing");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("missing");
    expect(isAppError(e)).toBe(true);
  });

  it("maps codes to HTTP statuses", () => {
    expect(httpStatusForCode("BAD_REQUEST")).toBe(400);
    expect(httpStatusForCode("RATE_LIMITED")).toBe(429);
    expect(httpStatusForCode("INTERNAL")).toBe(500);
  });
});

describe("isoToday / isoOffsetYears", () => {
  it("returns local-time `yyyy-mm-dd`", () => {
    const today = isoToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(today).toBe(expected);
  });

  it("offsets by positive years", () => {
    const plusTwo = isoOffsetYears(2);
    const year = Number(plusTwo.slice(0, 4));
    expect(year).toBe(new Date().getFullYear() + 2);
  });

  it("offsets by negative years", () => {
    const minus100 = isoOffsetYears(-100);
    const year = Number(minus100.slice(0, 4));
    expect(year).toBe(new Date().getFullYear() - 100);
  });

  it("zero offset matches today", () => {
    expect(isoOffsetYears(0)).toBe(isoToday());
  });
});
