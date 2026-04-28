import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "@/lib/computer/disclaimer";
import {
  buildCriteriaAnalysisPrompt,
  buildEvidencePlanPrompt,
  buildExhibitIndexPrompt,
  buildPersonalStatementPrompt,
  buildPetitionLetterPrompt,
  buildRecommendationLetterPrompt,
  buildSystemPrompt,
  type BuildContext,
} from "@/server/services/computer/prompts";

/**
 * Prompt-builder coverage. Each builder is a pure function — these
 * tests verify (a) every interpolation slot lands in the output,
 * (b) the disclaimer is referenced in the system prompt, (c) the
 * search policy + JSON schema match the per-output design table from
 * the Stage 7 plan.
 */

const ctx: BuildContext = {
  caseId: "11111111-1111-4111-8111-111111111111",
  snapshotAt: "2026-04-28T10:00:00.000Z",
  visaType: "O-1A",
  beneficiary: {
    fullName: "Test Beneficiary 001",
    nationality: "Canada",
    occupation: "Research Scientist",
    notes: "Strong publication record; recent NIH grant award.",
  },
  documents: [
    {
      id: "doc-1",
      type: "cv_resume",
      originalFilename: "cv.pdf",
      extractedText: "PhD in Bioinformatics, 2020. 15 peer-reviewed publications.",
      truncated: false,
    },
    {
      id: "doc-2",
      type: "publication",
      originalFilename: "nature-2024.pdf",
      extractedText: "Lorem ipsum dolor sit amet ".repeat(200),
      truncated: true,
    },
  ],
  evidencePlan: {
    visaType: "O-1A",
    overallStrength: "moderate",
    generatedAt: "2026-04-28T10:05:00.000Z",
    criteria: [
      {
        criterion: "Awards",
        assessment: "moderate",
        summary: "NIH career development award (2023).",
        gaps: ["No major prizes (Lasker, Nobel)"],
      },
      {
        criterion: "Published Material",
        assessment: "strong",
        summary: "15 peer-reviewed papers, h-index 12.",
        gaps: [],
      },
    ],
  },
  recommenders: [
    {
      id: "rec-1",
      fullName: "Prof. Jane Smith",
      role: "PhD advisor, Stanford",
      relationship: "Doctoral mentor 2016-2020; co-author on 3 papers.",
      guidance: "Emphasize independence and publication impact.",
    },
  ],
};

describe("buildSystemPrompt", () => {
  it("includes the visa-type label and the disclaimer", () => {
    const out = buildSystemPrompt("O-1A");
    expect(out).toContain("O-1A");
    expect(out).toContain(DISCLAIMER);
    expect(out).toContain("Never fabricate");
    expect(out).toContain("Never invent legal citations");
  });

  it("varies the visa-type label per visa type", () => {
    const a = buildSystemPrompt("EB-1A");
    const b = buildSystemPrompt("O-1B");
    expect(a).toContain("EB-1A");
    expect(b).toContain("O-1B");
    expect(a).not.toEqual(b);
  });
});

describe("buildEvidencePlanPrompt", () => {
  it("returns JSON-schema mode + web-search policy", () => {
    const spec = buildEvidencePlanPrompt(ctx);
    expect(spec.jsonSchema?.name).toBe("evidence_plan");
    expect(spec.searchPolicy).toEqual({ mode: "web" });
  });

  it("includes beneficiary details and document filenames", () => {
    const spec = buildEvidencePlanPrompt(ctx);
    expect(spec.userPrompt).toContain("Test Beneficiary 001");
    expect(spec.userPrompt).toContain("Research Scientist");
    expect(spec.userPrompt).toContain("cv.pdf");
    expect(spec.userPrompt).toContain("nature-2024.pdf");
  });
});

describe("buildPersonalStatementPrompt", () => {
  it("disables search (beneficiary's own story)", () => {
    const spec = buildPersonalStatementPrompt(ctx);
    expect(spec.searchPolicy).toEqual({ mode: "disabled" });
    expect(spec.jsonSchema).toBeUndefined();
  });

  it("requires evidencePlan to be present", () => {
    expect(() =>
      buildPersonalStatementPrompt({ ...ctx, evidencePlan: null }),
    ).toThrow(/evidencePlan must be populated/);
  });

  it("includes the prior evidence plan in the user prompt", () => {
    const spec = buildPersonalStatementPrompt(ctx);
    expect(spec.userPrompt).toContain("Awards");
    expect(spec.userPrompt).toContain("Published Material");
  });
});

describe("buildPetitionLetterPrompt", () => {
  it("uses web search with USCIS allowlist", () => {
    const spec = buildPetitionLetterPrompt(ctx);
    expect(spec.searchPolicy).toEqual({
      mode: "web",
      domainAllowlist: [
        "uscis.gov",
        "justice.gov",
        "aao.uscis.gov",
        "law.cornell.edu",
        "ecfr.gov",
      ],
    });
  });

  it("references the visa type in the caption guidance", () => {
    const spec = buildPetitionLetterPrompt(ctx);
    expect(spec.userPrompt).toContain("O-1A petition");
    expect(spec.userPrompt).toContain("Test Beneficiary 001");
  });

  it("requires evidencePlan to be present", () => {
    expect(() =>
      buildPetitionLetterPrompt({ ...ctx, evidencePlan: null }),
    ).toThrow(/evidencePlan must be populated/);
  });
});

describe("buildRecommendationLetterPrompt", () => {
  it("disables search (recommender's own voice)", () => {
    const spec = buildRecommendationLetterPrompt(ctx, ctx.recommenders[0]!);
    expect(spec.searchPolicy).toEqual({ mode: "disabled" });
  });

  it("includes recommender details and attorney guidance", () => {
    const spec = buildRecommendationLetterPrompt(ctx, ctx.recommenders[0]!);
    expect(spec.userPrompt).toContain("Prof. Jane Smith");
    expect(spec.userPrompt).toContain("PhD advisor, Stanford");
    expect(spec.userPrompt).toContain("Emphasize independence");
  });

  it("works without attorney guidance", () => {
    const spec = buildRecommendationLetterPrompt(ctx, {
      ...ctx.recommenders[0]!,
      guidance: null,
    });
    expect(spec.userPrompt).toContain("Prof. Jane Smith");
  });
});

describe("buildExhibitIndexPrompt", () => {
  it("uses JSON schema + disabled search", () => {
    const spec = buildExhibitIndexPrompt(ctx);
    expect(spec.jsonSchema?.name).toBe("exhibit_index");
    expect(spec.searchPolicy).toEqual({ mode: "disabled" });
  });

  it("includes every uploaded document", () => {
    const spec = buildExhibitIndexPrompt(ctx);
    for (const doc of ctx.documents) {
      expect(spec.userPrompt).toContain(doc.originalFilename);
    }
  });
});

describe("buildCriteriaAnalysisPrompt", () => {
  it("uses JSON schema + academic search", () => {
    const spec = buildCriteriaAnalysisPrompt(ctx);
    expect(spec.jsonSchema?.name).toBe("criteria_analysis");
    expect(spec.searchPolicy).toEqual({ mode: "academic" });
  });

  it("includes the prior evidence plan", () => {
    const spec = buildCriteriaAnalysisPrompt(ctx);
    expect(spec.userPrompt).toContain("Awards");
  });
});
