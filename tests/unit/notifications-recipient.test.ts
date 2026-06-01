import { describe, expect, it, vi } from "vitest";

/**
 * Pure helpers in `notifications/recipient.ts`. The DB-backed resolvers
 * (`resolveCaseRecipient`, `resolveOutputLabel`, `countApprovedOutputs`)
 * are exercised in integration tests; here we lock the deterministic
 * formatters that the email body depends on.
 *
 * Mocks below are minimum-required so the module's top-level imports
 * (`db`, `env`) don't crash on load — `appUrl` reads `env`, and `db` is
 * imported even though we never invoke the DB-touching exports.
 */

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/config/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://example.com" },
}));

const recipient = await import("@/server/services/email/notifications/recipient");

describe("buildCaseLabel", () => {
  it('produces "Name · VISA" when fullName is present', () => {
    expect(
      recipient.buildCaseLabel({
        beneficiaryData: { fullName: "Maria Gonzalez" },
        visaType: "O-1A",
      }),
    ).toBe("Maria Gonzalez · O-1A");
  });

  it('falls back to "Untitled case · VISA" when beneficiaryData is null', () => {
    expect(
      recipient.buildCaseLabel({ beneficiaryData: null, visaType: "EB-1A" }),
    ).toBe("Untitled case · EB-1A");
  });

  it("falls back when beneficiaryData fails the schema", () => {
    expect(
      recipient.buildCaseLabel({
        beneficiaryData: { not: "valid" },
        visaType: "O-1A",
      }),
    ).toBe("Untitled case · O-1A");
  });

  it("keeps the real name when a stored blob carries a legacy key (#69)", () => {
    // A row written before `currentLocation` was removed must not collapse
    // to "Untitled case" — the read-tolerant schema strips the dead key.
    expect(
      recipient.buildCaseLabel({
        beneficiaryData: {
          fullName: "Maria Gonzalez",
          currentLocation: "London, UK",
        },
        visaType: "O-1A",
      }),
    ).toBe("Maria Gonzalez · O-1A");
  });

  it("trims whitespace from fullName", () => {
    expect(
      recipient.buildCaseLabel({
        beneficiaryData: { fullName: "   Bob   " },
        visaType: "O-1A",
      }),
    ).toBe("Bob · O-1A");
  });

  it('treats whitespace-only fullName as missing → "Untitled case"', () => {
    expect(
      recipient.buildCaseLabel({
        beneficiaryData: { fullName: "   " },
        visaType: "O-1A",
      }),
    ).toBe("Untitled case · O-1A");
  });
});

describe("nameOrLocalPart", () => {
  it("returns the name when present", () => {
    expect(recipient.nameOrLocalPart("Alice", "alice@example.com")).toBe("Alice");
  });

  it("falls back to email local-part when name is null", () => {
    expect(recipient.nameOrLocalPart(null, "bob.smith@example.com")).toBe(
      "bob.smith",
    );
  });

  it("falls back when name is empty string", () => {
    expect(recipient.nameOrLocalPart("", "carol@example.com")).toBe("carol");
  });

  it("falls back when name is whitespace only", () => {
    expect(recipient.nameOrLocalPart("   ", "dave@example.com")).toBe("dave");
  });

  it("returns the whole email when no @ is present (defensive)", () => {
    expect(recipient.nameOrLocalPart(null, "weird-no-at")).toBe("weird-no-at");
  });
});

describe("appUrl + URL helpers", () => {
  it("joins origin + path with a single slash", () => {
    expect(recipient.appUrl("/dashboard")).toBe("https://example.com/dashboard");
  });

  it("caseUrl points at the case overview", () => {
    const url = recipient.caseUrl("c-123");
    expect(url.startsWith("https://example.com/")).toBe(true);
    expect(url).toContain("c-123");
  });

  it("outputUrl includes both ids", () => {
    const url = recipient.outputUrl("c-1", "o-2");
    expect(url).toContain("c-1");
    expect(url).toContain("o-2");
  });

  it("dashboardUrl is non-empty", () => {
    expect(recipient.dashboardUrl().length).toBeGreaterThan(0);
  });

  it("signInUrl is non-empty", () => {
    expect(recipient.signInUrl().length).toBeGreaterThan(0);
  });
});
