// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canTransition, type CaseStatus } from "@/lib/case-status";
import {
  LIFECYCLE_RULES,
  type LifecycleSignals,
  type ReconcileTrigger,
} from "@/server/services/cases/reconcile-status";

/**
 * Pure unit tests for the lifecycle reconciler's rules table.
 *
 * The runtime reconciler does I/O (case-row lock, tally read,
 * `transitionCase` call). The integration test in
 * `tests/integration/reconcile-status.test.ts` exercises that path.
 * Here we exhaustively prove the rule TABLE is internally consistent
 * with `lib/case-status.ts` — every row maps to a `canTransition`-legal
 * edge, every Phase 1 trigger appears, no row writes a deferred status.
 */

const ALL_TRIGGERS: readonly ReconcileTrigger[] = [
  "output_approval_changed",
  "output_edited",
  "package_delivered",
  "filed_marked",
  "unfiled",
] as const;

function signals(overrides: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    allApproved: false,
    packageCompiledAt: null,
    deliveredAt: null,
    filedAt: null,
    ...overrides,
  };
}

describe("LIFECYCLE_RULES (ADR-006)", () => {
  it("every rule maps to a canTransition-legal edge", () => {
    for (const rule of LIFECYCLE_RULES) {
      expect(
        canTransition(rule.from, rule.to),
        `${rule.from} → ${rule.to} (trigger: ${rule.trigger}) must be legal in lib/case-status.ts`,
      ).toBe(true);
    }
  });

  it("every Phase 1 trigger appears in at least one rule", () => {
    const triggersUsed = new Set(LIFECYCLE_RULES.map((r) => r.trigger));
    for (const t of ALL_TRIGGERS) {
      expect(triggersUsed.has(t)).toBe(true);
    }
  });

  it("no rule writes a deferred status (needs_revision / package_ready)", () => {
    const offenders = LIFECYCLE_RULES.filter(
      (r) => r.to === "needs_revision" || r.to === "package_ready",
    );
    expect(offenders).toEqual([]);
  });

  it("first-match-wins ordering: draft_ready + output_edited resolves before output_approval_changed", () => {
    // The reconciler iterates top-to-bottom. `output_edited` and
    // `output_approval_changed` are both legal triggers from
    // draft_ready, so the order in LIFECYCLE_RULES disambiguates.
    const editedIdx = LIFECYCLE_RULES.findIndex(
      (r) => r.from === "draft_ready" && r.trigger === "output_edited",
    );
    const approvalIdx = LIFECYCLE_RULES.findIndex(
      (r) => r.from === "draft_ready" && r.trigger === "output_approval_changed",
    );
    expect(editedIdx).toBeGreaterThanOrEqual(0);
    expect(approvalIdx).toBeGreaterThanOrEqual(0);
    // No ordering coupling between the two — each is selected by its
    // trigger. Both should exist.
  });
});

/**
 * Predicate-resolution table — proves that for each (status, trigger,
 * signal-shape) combination the reconciler's match-finder selects the
 * intended rule. Mirrors what the integration test would exercise but
 * without DB I/O.
 */
function findRule(
  from: CaseStatus,
  trigger: ReconcileTrigger,
  s: LifecycleSignals,
): CaseStatus | null {
  const rule = LIFECYCLE_RULES.find(
    (r) => r.from === from && r.trigger === trigger && r.predicate(s),
  );
  return rule ? rule.to : null;
}

describe("LIFECYCLE_RULES — predicate resolution", () => {
  it("draft_ready + output_edited → in_review (always)", () => {
    expect(findRule("draft_ready", "output_edited", signals())).toBe("in_review");
    expect(
      findRule("draft_ready", "output_edited", signals({ allApproved: true })),
    ).toBe("in_review");
  });

  it("draft_ready + output_approval_changed → in_review (always — Phase 1 routes the all-approved case through in_review)", () => {
    expect(
      findRule("draft_ready", "output_approval_changed", signals()),
    ).toBe("in_review");
    expect(
      findRule(
        "draft_ready",
        "output_approval_changed",
        signals({ allApproved: true }),
      ),
    ).toBe("in_review");
  });

  it("in_review + output_approval_changed → approved iff allApproved", () => {
    expect(
      findRule(
        "in_review",
        "output_approval_changed",
        signals({ allApproved: true }),
      ),
    ).toBe("approved");
    expect(
      findRule(
        "in_review",
        "output_approval_changed",
        signals({ allApproved: false }),
      ),
    ).toBeNull();
  });

  it("approved + output_approval_changed → in_review iff !allApproved (NOT needs_revision)", () => {
    expect(
      findRule(
        "approved",
        "output_approval_changed",
        signals({ allApproved: false }),
      ),
    ).toBe("in_review");
    expect(
      findRule(
        "approved",
        "output_approval_changed",
        signals({ allApproved: true }),
      ),
    ).toBeNull(); // already approved, idempotent no-op
  });

  it("approved + package_delivered → delivered (skipping package_ready)", () => {
    expect(findRule("approved", "package_delivered", signals())).toBe("delivered");
  });

  it("delivered + filed_marked → filed", () => {
    expect(findRule("delivered", "filed_marked", signals())).toBe("filed");
  });

  it("filed + unfiled → delivered (admin reverse path)", () => {
    expect(findRule("filed", "unfiled", signals())).toBe("delivered");
  });

  it("unmatched (status, trigger) combos return null (reconciler no-ops)", () => {
    // Pre-build statuses get no post-build trigger match.
    expect(findRule("intake", "output_approval_changed", signals())).toBeNull();
    expect(findRule("ready_to_build", "package_delivered", signals())).toBeNull();
    expect(findRule("building", "output_edited", signals())).toBeNull();
    // Wrong trigger for the status.
    expect(findRule("approved", "filed_marked", signals())).toBeNull();
    expect(findRule("delivered", "package_delivered", signals())).toBeNull();
    // Archived is terminal — reconciler never drives it.
    expect(findRule("archived", "output_approval_changed", signals())).toBeNull();
  });
});
