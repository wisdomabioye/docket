import { describe, expect, it } from "vitest";
import {
  AuditDetailsSchema,
  BeneficiaryDataSchema,
  CriteriaAnalysisSchema,
  DocumentChecklistSchema,
  EvidencePlanSchema,
  OutputMetadataSchema,
} from "@/server/db/schema/zod";

/**
 * Validation tests for jsonb column schemas. These are the source of truth
 * for blob shape; Drizzle column types are linked via `.$type<>()`. Three
 * tests per schema: accepts a valid sample, rejects an invalid sample,
 * exercises a defaults / partial behavior.
 */

describe("BeneficiaryDataSchema", () => {
  it("accepts a partial valid object", () => {
    const r = BeneficiaryDataSchema.safeParse({
      fullName: "Test Beneficiary 001",
      nationality: "Canada",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    const r = BeneficiaryDataSchema.safeParse({
      fullName: "Test",
      socialSecurityNumber: "123-45-6789", // not in schema
    });
    expect(r.success).toBe(false);
  });

  it("rejects an oversize notes field", () => {
    const r = BeneficiaryDataSchema.safeParse({ notes: "x".repeat(5001) });
    expect(r.success).toBe(false);
  });
});

describe("EvidencePlanSchema", () => {
  it("accepts a populated plan", () => {
    const r = EvidencePlanSchema.safeParse({
      visaType: "O-1A",
      overallStrength: "moderate",
      generatedAt: new Date().toISOString(),
      criteria: [
        {
          criterion: "awards",
          assessment: "strong",
          summary: "Three industry awards documented.",
          gaps: [],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown overallStrength enum value", () => {
    const r = EvidencePlanSchema.safeParse({
      visaType: "O-1A",
      overallStrength: "excellent", // not in enum
      generatedAt: new Date().toISOString(),
      criteria: [],
    });
    expect(r.success).toBe(false);
  });

  it("defaults gaps to empty array on each criterion", () => {
    const parsed = EvidencePlanSchema.parse({
      visaType: "EB-1A",
      overallStrength: "weak",
      generatedAt: new Date().toISOString(),
      criteria: [
        { criterion: "press", assessment: "weak", summary: "no coverage" },
      ],
    });
    expect(parsed.criteria[0]?.gaps).toEqual([]);
  });
});

describe("CriteriaAnalysisSchema", () => {
  it("accepts a valid analysis", () => {
    const r = CriteriaAnalysisSchema.safeParse({
      visaType: "O-1A",
      metCount: 3,
      requiredCount: 3,
      items: [
        {
          criterion: "awards",
          met: true,
          rationale: "Three awards documented in exhibits A-C.",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative metCount", () => {
    const r = CriteriaAnalysisSchema.safeParse({
      visaType: "O-1A",
      metCount: -1,
      requiredCount: 3,
      items: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects items missing rationale", () => {
    const r = CriteriaAnalysisSchema.safeParse({
      visaType: "O-1A",
      metCount: 1,
      requiredCount: 3,
      items: [{ criterion: "awards", met: true }],
    });
    expect(r.success).toBe(false);
  });
});

describe("DocumentChecklistSchema", () => {
  it("accepts a checklist", () => {
    const r = DocumentChecklistSchema.safeParse({
      visaType: "O-1A",
      items: [{ label: "CV / résumé", required: true }],
    });
    expect(r.success).toBe(true);
  });

  it("defaults received/documentIds on each item", () => {
    const parsed = DocumentChecklistSchema.parse({
      visaType: "O-1A",
      items: [{ label: "CV", required: true }],
    });
    expect(parsed.items[0]?.received).toBe(false);
    expect(parsed.items[0]?.documentIds).toEqual([]);
  });

  it("rejects empty label", () => {
    const r = DocumentChecklistSchema.safeParse({
      visaType: "O-1A",
      items: [{ label: "", required: true }],
    });
    expect(r.success).toBe(false);
  });
});

describe("OutputMetadataSchema", () => {
  it("accepts recommendation_letter_template metadata", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "recommendation_letter_template",
      recommenderName: "Dr. Test Recommender",
      recommenderRelationship: "PhD advisor",
    });
    expect(r.success).toBe(true);
  });

  it("accepts exhibit_index metadata", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "exhibit_index",
      exhibitCount: 12,
    });
    expect(r.success).toBe(true);
  });

  it("falls back to generic metadata for unknown types", () => {
    const r = OutputMetadataSchema.safeParse({
      type: "personal_statement",
      notes: "first draft",
      // passthrough fields allowed in generic
      anyExtra: "value",
    });
    expect(r.success).toBe(true);
  });
});

describe("AuditDetailsSchema", () => {
  it("accepts a typical audit row payload", () => {
    const r = AuditDetailsSchema.safeParse({
      reason: "manual admin activation",
      before: { status: "pending" },
      after: { status: "active" },
    });
    expect(r.success).toBe(true);
  });

  it("preserves unknown fields (passthrough)", () => {
    const parsed = AuditDetailsSchema.parse({
      reason: "x",
      futureField: "ok",
    });
    expect((parsed as Record<string, unknown>).futureField).toBe("ok");
  });

  it("rejects oversize reason", () => {
    const r = AuditDetailsSchema.safeParse({ reason: "x".repeat(2001) });
    expect(r.success).toBe(false);
  });
});
