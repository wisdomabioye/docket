// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import { appRouter } from "@/server/api/root";

/**
 * ADR-006 Step 7 — guard against accidental cross-router leakage of
 * admin-only mutations. The procedure that reverses a filed case
 * (`unmarkFiledCase`) lives on the admin router only; the attorney
 * routers (`case`, `output`) must NOT expose it (or anything matching
 * the `unmark*` pattern reserved for ops-tier reversals).
 *
 * If a future contributor copy-pastes the admin procedure into the
 * attorney router this test fails — the failure surfaces the
 * leak by name.
 */

function procedureKeys(router: unknown): string[] {
  if (!router || typeof router !== "object") return [];
  // In tRPC v11 a sub-router's enumerable own keys ARE its procedure
  // names (the router IS the proxy). Filter out any internal keys
  // beginning with `_` so we never accidentally count `_def` etc.
  return Object.keys(router as Record<string, unknown>).filter(
    (k) => !k.startsWith("_"),
  );
}

describe("appRouter shape (ADR-006 Step 7)", () => {
  it("admin router exposes unmarkFiledCase", () => {
    const adminKeys = procedureKeys(
      (appRouter as unknown as { admin: unknown }).admin,
    );
    expect(adminKeys).toContain("unmarkFiledCase");
  });

  it("attorney-facing routers do NOT expose unmark* procedures", () => {
    const checked: Record<string, string[]> = {};
    const attorneyFacing = ["case", "output", "document", "recommender"] as const;
    for (const name of attorneyFacing) {
      const sub = (appRouter as unknown as Record<string, unknown>)[name];
      checked[name] = procedureKeys(sub).filter((k) =>
        k.toLowerCase().startsWith("unmark"),
      );
    }
    expect(checked).toEqual({
      case: [],
      output: [],
      document: [],
      recommender: [],
    });
  });

  it("case router exposes markFiled (forward direction)", () => {
    const caseKeys = procedureKeys(
      (appRouter as unknown as { case: unknown }).case,
    );
    expect(caseKeys).toContain("markFiled");
  });
});
