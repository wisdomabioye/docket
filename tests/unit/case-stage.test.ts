import { describe, expect, it } from "vitest";
import { deriveCaseStage } from "@/lib/case-stage";
import { CASE_STATUSES } from "@/lib/case-status";

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
      "Complete intake form",
    );
    expect(deriveCaseStage({ status: "draft_ready" }).nextAction).toBe(
      "Review drafts",
    );
    expect(deriveCaseStage({ status: "delivered" }).nextAction).toBe(
      "Mark filed",
    );
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
