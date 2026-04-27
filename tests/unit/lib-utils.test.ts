import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
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
