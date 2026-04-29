import { describe, expect, it } from "vitest";
import { Inngest } from "inngest";
import { inngest } from "@/server/jobs/client";
import { inngestFunctions } from "@/server/jobs";

/**
 * Smoke tests for the Inngest singleton + function registry. The full
 * orchestration is exercised with the in-memory test harness in Phase
 * 9-10; here we just lock the boundary: the client exists, has a stable
 * id, and the registry is the array the route handler imports.
 */

describe("inngest client", () => {
  it("is an Inngest instance", () => {
    expect(inngest).toBeInstanceOf(Inngest);
  });

  it('uses app id "docket" — changing this orphans existing event history', () => {
    expect(inngest.id).toBe("docket");
  });
});

describe("inngestFunctions registry", () => {
  it("is an array", () => {
    expect(Array.isArray(inngestFunctions)).toBe(true);
  });

  it("registers all Phase 9-10 functions (regression guard)", () => {
    // Hard-coding the expected ids catches accidental drops if a
    // `import { ... } from "..."` line gets removed during refactors.
    // Order isn't enforced — Inngest doesn't care.
    const ids = inngestFunctions.map((f) => f.id());
    expect(new Set(ids)).toEqual(
      new Set([
        "output-evidence-plan",
        "output-personal-statement",
        "output-petition-letter",
        "output-recommendation-letter",
        "output-exhibit-index",
        "computer-health",
        "case-build-failed",
        "case-build",
        "regenerate-output",
        "case-build-watchdog",
      ]),
    );
  });

  it("each registered function exposes a stable id (no anonymous functions)", () => {
    for (const fn of inngestFunctions) {
      expect(fn.id()).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });
});
