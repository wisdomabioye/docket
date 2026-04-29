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
  it("is an array (empty until Phase 9-10 populates it)", () => {
    expect(Array.isArray(inngestFunctions)).toBe(true);
  });
});
