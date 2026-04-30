// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PIPELINE_STATUSES, parsePipelineKey } from "@/lib/pipeline";

/**
 * Regression guard for the bug where the sidebar's `?stage=...` links
 * silently no-op'd. The dashboard now reads `searchParams.stage`,
 * narrows via `parsePipelineKey`, and looks up the status array via
 * `PIPELINE_STATUSES[stage]`. This test pins the contract — a known
 * stage value yields the expected status filter.
 */
describe("dashboard stage filter", () => {
  it("`?stage=intake` resolves to ['intake']", () => {
    const stage = parsePipelineKey("intake");
    expect(stage).toBe("intake");
    expect(stage && PIPELINE_STATUSES[stage]).toEqual(["intake"]);
  });

  it("`?stage=documents` resolves to the multi-status documents bucket", () => {
    const stage = parsePipelineKey("documents");
    expect(stage).toBe("documents");
    expect(stage && PIPELINE_STATUSES[stage]).toEqual([
      "documents_pending",
      "extracting",
      "ready_to_build",
    ]);
  });

  it("`?stage=drafting` includes draft_ready", () => {
    const stage = parsePipelineKey("drafting");
    expect(stage && PIPELINE_STATUSES[stage]).toContain("draft_ready");
  });

  it("`?stage=review` includes needs_revision", () => {
    const stage = parsePipelineKey("review");
    expect(stage && PIPELINE_STATUSES[stage]).toContain("needs_revision");
  });

  it("`?stage=filed` includes the filed status (lifecycle terminal)", () => {
    const stage = parsePipelineKey("filed");
    expect(stage && PIPELINE_STATUSES[stage]).toContain("filed");
  });

  it("an unknown stage falls back to null (dashboard renders all)", () => {
    expect(parsePipelineKey("typo")).toBeNull();
    expect(parsePipelineKey(undefined)).toBeNull();
  });
});
