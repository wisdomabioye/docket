import { describe, expect, it } from "vitest";
import { OutputMetadataSchema } from "@/server/db/schema/zod";

/**
 * `OutputMetadataSchema` is a `z.discriminatedUnion("type", ...)` since
 * Stage 08 (resolves open_issues #19.4). The previous `z.union` matched
 * the `passthrough()` GenericMetadata branch for any malformed shape on
 * `recommendation_letter_template` / `exhibit_index` rows — typed-branch
 * fields were silently accepted at the wrong shape.
 *
 * Locked behaviors:
 *   - Discriminator picks the right branch when `type` matches a typed
 *     literal.
 *   - Typed branches reject extra/wrong fields strictly.
 *   - Generic branch (other output types) still accepts pass-through.
 *   - Missing/unknown discriminator value rejected.
 */

describe("OutputMetadataSchema discriminator routing", () => {
  it("recommendation_letter_template branch parses recommender fields", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "recommendation_letter_template",
      recommenderName: "Jane Doe",
      recommenderRelationship: "PhD advisor",
      recommenderTitle: "Professor",
    });
    expect(r.success).toBe(true);
  });

  it("recommendation_letter_template REJECTS unknown fields (strict)", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "recommendation_letter_template",
      recommenderName: "Jane Doe",
      // `imposter` is not in the typed branch's allow-list.
      imposter: "anything",
    });
    expect(r.success).toBe(false);
  });

  it("exhibit_index branch parses exhibitCount", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "exhibit_index",
      exhibitCount: 5,
    });
    expect(r.success).toBe(true);
  });

  it("exhibit_index REJECTS negative count", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "exhibit_index",
      exhibitCount: -1,
    });
    expect(r.success).toBe(false);
  });
});

describe("OutputMetadataSchema generic branch (passthrough)", () => {
  it("accepts evidence_plan with arbitrary additional fields", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "evidence_plan",
      provider: "perplexity-sonar",
      model: "sonar-pro",
      anyExtraField: "ok",
    });
    expect(r.success).toBe(true);
  });

  it("accepts personal_statement / petition_letter / criteria_analysis / cover_letter / form_g1145 / other", () => {
    for (const t of [
      "personal_statement",
      "petition_letter",
      "criteria_analysis",
      "cover_letter",
      "form_g1145",
      "other",
    ] as const) {
      const r = OutputMetadataSchema.safeParse({ type: t });
      expect(r.success).toBe(true);
    }
  });
});

describe("OutputMetadataSchema discriminator failures", () => {
  it("rejects an unknown `type` value", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "not-a-real-type",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing `type` discriminator", () => {
    const r = OutputMetadataSchema.safeParse({
      recommenderName: "Jane Doe",
    });
    expect(r.success).toBe(false);
  });
});
