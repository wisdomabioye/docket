import { describe, expect, it } from "vitest";
import {
  deriveCasePrimaryAction,
  deriveCaseStage,
  isInProgressStatus,
} from "@/lib/case-stage";
import {
  CASE_STATUSES,
  type CaseStatus,
  TODAY_ACTIONABLE_STATUSES,
} from "@/lib/case-status";

describe("deriveCaseStage", () => {
  it("covers every status in the schema enum", () => {
    // Exhaustiveness guard: if the enum grows, this test fails until
    // the new case lands in the switch.
    for (const status of CASE_STATUSES) {
      expect(() => deriveCaseStage({ status })).not.toThrow();
    }
  });

  it("buckets statuses into their PIPELINE_STATUSES key", () => {
    expect(deriveCaseStage({ status: "intake" }).pipelineKey).toBe("intake");
    expect(deriveCaseStage({ status: "documents_pending" }).pipelineKey).toBe(
      "documents",
    );
    expect(deriveCaseStage({ status: "extracting" }).pipelineKey).toBe(
      "documents",
    );
    expect(deriveCaseStage({ status: "ready_to_build" }).pipelineKey).toBe(
      "documents",
    );
    expect(deriveCaseStage({ status: "building" }).pipelineKey).toBe("drafting");
    expect(deriveCaseStage({ status: "build_failed" }).pipelineKey).toBe(
      "drafting",
    );
    expect(deriveCaseStage({ status: "draft_ready" }).pipelineKey).toBe(
      "drafting",
    );
    expect(deriveCaseStage({ status: "in_review" }).pipelineKey).toBe("review");
    expect(deriveCaseStage({ status: "needs_revision" }).pipelineKey).toBe(
      "review",
    );
    expect(deriveCaseStage({ status: "approved" }).pipelineKey).toBe("review");
    expect(deriveCaseStage({ status: "package_ready" }).pipelineKey).toBe(
      "filed",
    );
    expect(deriveCaseStage({ status: "delivered" }).pipelineKey).toBe("filed");
    expect(deriveCaseStage({ status: "filed" }).pipelineKey).toBe("filed");
    expect(deriveCaseStage({ status: "archived" }).pipelineKey).toBe("filed");
  });

  it("monotonic progressPct across the lifecycle", () => {
    const order = [
      "intake",
      "documents_pending",
      "extracting",
      "ready_to_build",
      "building",
      "draft_ready",
      "in_review",
      "approved",
      "package_ready",
      "delivered",
      "filed",
    ] as const;
    let prev = -1;
    for (const status of order) {
      const pct = deriveCaseStage({ status }).progressPct;
      expect(pct, `${status} pct=${pct}`).toBeGreaterThan(prev);
      prev = pct;
    }
  });

  it("in_review label includes approval count when present", () => {
    const stage = deriveCaseStage({
      status: "in_review",
      approvals: { approved: 2, total: 5 },
    });
    expect(stage.label).toBe("In review · 2/5");
    expect(stage.sub).toBe("2 of 5 outputs approved.");
  });

  it("in_review label omits approval count when total is 0", () => {
    const stage = deriveCaseStage({
      status: "in_review",
      approvals: { approved: 0, total: 0 },
    });
    expect(stage.label).toBe("In review");
  });

  it("terminal / waiting states have no nextAction", () => {
    expect(deriveCaseStage({ status: "extracting" }).nextAction).toBeUndefined();
    expect(deriveCaseStage({ status: "building" }).nextAction).toBeUndefined();
    expect(deriveCaseStage({ status: "filed" }).nextAction).toBeUndefined();
    expect(deriveCaseStage({ status: "archived" }).nextAction).toBeUndefined();
  });

  it("actionable states surface a CTA", () => {
    expect(deriveCaseStage({ status: "intake" }).nextAction).toBe(
      "Complete intake",
    );
    expect(deriveCaseStage({ status: "draft_ready" }).nextAction).toBe(
      "Review drafts",
    );
    expect(deriveCaseStage({ status: "delivered" }).nextAction).toBe(
      "Mark as filed",
    );
  });

  it("every TODAY_ACTIONABLE_STATUSES entry has a non-null nextAction", () => {
    // Invariant: the `me.todayTasks` rail composes its label as
    // `${stage.nextAction ?? stage.label} · ${who}`. The fallback
    // exists for type safety, but in practice every actionable status
    // MUST resolve to a real CTA — otherwise the rail reads as a
    // labeled state ("Building drafts · Alice") instead of an action
    // ("Apply revisions · Alice"). If this test fails, either the
    // status was added to TODAY_ACTIONABLE_STATUSES by mistake or its
    // stage entry in `case-stage.ts` is missing a `nextAction`.
    for (const status of TODAY_ACTIONABLE_STATUSES) {
      const stage = deriveCaseStage({ status });
      expect(stage.nextAction, `${status} should have a nextAction CTA`)
        .toBeDefined();
    }
  });

  it("archived buckets into 'filed' so the rail still renders cleanly", () => {
    // Archived is intentionally outside PIPELINE_STATUSES (it's a
    // terminal flag, not lifecycle progress). The rail collapses it
    // into the rightmost bucket so cases don't drop out of the UI.
    const stage = deriveCaseStage({ status: "archived" });
    expect(stage.pipelineKey).toBe("filed");
    expect(stage.label).toBe("Archived");
    expect(stage.progressPct).toBe(100);
  });
});

describe("deriveCasePrimaryAction", () => {
  const CASE_ID = "case-xyz";

  // Statuses with NO attorney action: in-progress (extracting, building)
  // and terminal (filed, archived). Everything else must resolve.
  const NO_ACTION: ReadonlyArray<CaseStatus> = [
    "extracting",
    "building",
    "filed",
    "archived",
  ];

  it("returns null for in-progress and terminal statuses", () => {
    for (const status of NO_ACTION) {
      expect(
        deriveCasePrimaryAction(status, CASE_ID),
        `${status} should have no primary action`,
      ).toBeNull();
    }
  });

  it("resolves a label, href, and kind for every actionable status", () => {
    const expected: Partial<
      Record<CaseStatus, { label: string; href: string; kind: string }>
    > = {
      intake: { label: "Complete intake", href: `/case/${CASE_ID}/intake`, kind: "intake" },
      documents_pending: {
        label: "Upload evidence",
        href: `/case/${CASE_ID}/documents`,
        kind: "documents",
      },
      ready_to_build: { label: "Build case", href: `/case/${CASE_ID}/build`, kind: "build" },
      build_failed: { label: "Retry build", href: `/case/${CASE_ID}/build`, kind: "build" },
      draft_ready: { label: "Review drafts", href: `/case/${CASE_ID}/outputs`, kind: "review" },
      in_review: { label: "Continue review", href: `/case/${CASE_ID}/outputs`, kind: "review" },
      needs_revision: { label: "Apply revisions", href: `/case/${CASE_ID}/outputs`, kind: "review" },
      approved: { label: "Download package", href: `/case/${CASE_ID}/package`, kind: "package" },
      package_ready: { label: "Download package", href: `/case/${CASE_ID}/package`, kind: "package" },
      delivered: { label: "Mark as filed", href: `/case/${CASE_ID}/package`, kind: "package" },
    };
    for (const [status, want] of Object.entries(expected)) {
      expect(
        deriveCasePrimaryAction(status as CaseStatus, CASE_ID),
        `${status} primary action`,
      ).toEqual(want);
    }
  });

  it("covers every enum value (resolved or explicitly null) — no gaps", () => {
    for (const status of CASE_STATUSES) {
      const action = deriveCasePrimaryAction(status, CASE_ID);
      if (NO_ACTION.includes(status)) {
        expect(action, `${status}`).toBeNull();
      } else {
        expect(action, `${status}`).not.toBeNull();
      }
    }
  });

  it("is the single source for deriveCaseStage.nextAction (no drift)", () => {
    // The rail hint and the header CTA must never disagree — both read
    // this one table. nextAction === the primary action's label, or
    // undefined when there is no action.
    for (const status of CASE_STATUSES) {
      const action = deriveCasePrimaryAction(status, CASE_ID);
      const { nextAction } = deriveCaseStage({ status });
      expect(nextAction, `${status}`).toBe(action?.label);
    }
  });
});

describe("isInProgressStatus", () => {
  it("true only for extracting and building", () => {
    expect(isInProgressStatus("extracting")).toBe(true);
    expect(isInProgressStatus("building")).toBe(true);
  });

  it("false for every other status", () => {
    for (const status of CASE_STATUSES) {
      if (status === "extracting" || status === "building") continue;
      expect(isInProgressStatus(status), `${status}`).toBe(false);
    }
  });
});
