import { describe, expect, it } from "vitest";
import { formatTrpcError } from "@/lib/trpc/format-error";

describe("formatTrpcError", () => {
  it("returns null for null/undefined", () => {
    expect(formatTrpcError(null)).toBeNull();
    expect(formatTrpcError(undefined)).toBeNull();
  });

  it("returns the first fieldError message per field, humanized", () => {
    const err = {
      message: "Input validation failed",
      data: {
        zodError: {
          fieldErrors: {
            fullName: ["Must be at least 1 character"],
            dateOfBirth: ["Must be a valid date", "Required"],
          },
          formErrors: [],
        },
      },
    };
    const out = formatTrpcError(err);
    expect(out).toBe(
      "Full name: Must be at least 1 character\nDate of birth: Must be a valid date",
    );
  });

  it("skips empty fieldError arrays", () => {
    const err = {
      message: "x",
      data: {
        zodError: {
          fieldErrors: {
            fullName: ["Required"],
            occupation: [],
          },
        },
      },
    };
    expect(formatTrpcError(err)).toBe("Full name: Required");
  });

  it("includes formErrors after fieldErrors", () => {
    const err = {
      data: {
        zodError: {
          fieldErrors: { fullName: ["Required"] },
          formErrors: ["At least one field must be set"],
        },
      },
    };
    expect(formatTrpcError(err)).toBe(
      "Full name: Required\nAt least one field must be set",
    );
  });

  it("falls back to message when zodError is empty", () => {
    const err = {
      message: "Recommender list changed under us.",
      data: {
        zodError: {
          fieldErrors: {},
          formErrors: [],
        },
      },
    };
    expect(formatTrpcError(err)).toBe("Recommender list changed under us.");
  });

  it("falls back to message when no zodError present", () => {
    expect(
      formatTrpcError({ message: "case not found", data: null }),
    ).toBe("case not found");
  });

  it("handles snake_case field names", () => {
    const err = {
      data: { zodError: { fieldErrors: { bar_number: ["Invalid format"] } } },
    };
    expect(formatTrpcError(err)).toBe("Bar number: Invalid format");
  });

  it("returns Error.message for plain Error objects", () => {
    expect(formatTrpcError(new Error("Network down"))).toBe("Network down");
  });

  it("returns the string itself when a string was thrown", () => {
    expect(formatTrpcError("boom")).toBe("boom");
  });

  it("returns a generic fallback for unknown shapes", () => {
    expect(formatTrpcError({})).toBe("Unexpected error.");
    expect(formatTrpcError(42)).toBe("Unexpected error.");
  });
});
