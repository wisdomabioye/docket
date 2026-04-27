import { describe, expect, it } from "vitest";
import { randomSuffix, slugBase } from "@/server/auth/slug";

describe("slugBase", () => {
  it("uses the email-local part lowercased", () => {
    expect(slugBase("Jane.Doe@example.com")).toBe("jane-doe");
    expect(slugBase("ATTORNEY+1@firm.com")).toBe("attorney-1");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugBase("a!b@c.com")).toBe("a-b");
    expect(slugBase("@x.com")).toBe("user"); // empty local → fallback
    expect(slugBase("____@x.com")).toBe("user"); // becomes empty after collapse
  });

  it("collapses runs of dashes and trims edges", () => {
    expect(slugBase("a..b..c@x.com")).toBe("a-b-c");
    expect(slugBase("--abc--@x.com")).toBe("abc");
  });

  it("truncates to 32 chars", () => {
    expect(slugBase("a".repeat(50) + "@x.com")).toHaveLength(32);
  });

  it("returns fallback for malformed inputs", () => {
    expect(slugBase("@x.com")).toBe("user");
    expect(slugBase("")).toBe("user");
  });

  it("preserves digits", () => {
    expect(slugBase("user42@x.com")).toBe("user42");
  });
});

describe("randomSuffix", () => {
  it("returns a 6-character base36 string", () => {
    for (let i = 0; i < 50; i++) {
      const s = randomSuffix();
      expect(s).toHaveLength(6);
      expect(s).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("rarely collides", () => {
    // Smoke test — generate 1k samples, expect no duplicates with high
    // probability (collision rate ~1 in 2.1B per pair).
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(randomSuffix());
    expect(seen.size).toBe(1000);
  });
});
