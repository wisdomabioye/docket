// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CASE_STATUSES } from "@/lib/constants";
import {
  PIPELINE_KEYS,
  PIPELINE_STATUSES,
  parsePipelineKey,
} from "@/lib/pipeline";

describe("PIPELINE_STATUSES", () => {
  it("every status is referenced by exactly one bucket (or excluded for archived)", () => {
    const seen = new Set<string>();
    for (const key of PIPELINE_KEYS) {
      for (const status of PIPELINE_STATUSES[key]) {
        expect(seen.has(status), `${status} appears in two buckets`).toBe(
          false,
        );
        seen.add(status);
      }
    }
    // Every case status except `archived` (which has no sidebar bucket
    // by design — the spec hides archived cases from pipeline counts)
    // must show up in some bucket.
    for (const status of CASE_STATUSES) {
      if (status === "archived") continue;
      expect(seen.has(status), `${status} not bucketed`).toBe(true);
    }
  });
});

describe("parsePipelineKey", () => {
  it("returns the key for known string values", () => {
    for (const key of PIPELINE_KEYS) {
      expect(parsePipelineKey(key)).toBe(key);
    }
  });

  it("returns null for unknown / undefined / non-string values", () => {
    expect(parsePipelineKey(undefined)).toBeNull();
    expect(parsePipelineKey(null)).toBeNull();
    expect(parsePipelineKey("")).toBeNull();
    expect(parsePipelineKey("typo")).toBeNull();
    expect(parsePipelineKey(42)).toBeNull();
    expect(parsePipelineKey({})).toBeNull();
  });
});
