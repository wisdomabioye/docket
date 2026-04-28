import "server-only";
import { buildSystemPrompt } from "./system";
import type { BuildContext, PromptSpec } from "./context";

/**
 * Criteria analysis — per-criterion ruling on whether the petition
 * meets the regulatory bar, with rationale + supporting exhibits.
 * Distinct from the evidence plan (which surveys what's there);
 * criteria-analysis takes a position on whether each criterion is
 * satisfied.
 *
 * Search mode: `academic`. Cites peer-reviewed immigration scholarship
 * and USCIS regulatory commentary; "academic" mode targets these
 * sources without dragging in arbitrary commentary.
 *
 * Structured output mirroring `CriteriaAnalysisSchema`.
 */
export function buildCriteriaAnalysisPrompt(ctx: BuildContext): PromptSpec {
  if (!ctx.evidencePlan) {
    throw new Error(
      "buildCriteriaAnalysisPrompt: evidencePlan must be populated; this output's per-criterion ruling depends on the prior evidence assessment.",
    );
  }

  const userPrompt = [
    `Visa type: ${ctx.visaType}`,
    `Beneficiary: ${ctx.beneficiary.fullName ?? "(name not provided)"}`,
    "",
    "Evidence plan (from prior step):",
    JSON.stringify(ctx.evidencePlan, null, 2),
    "",
    `Documents available (${ctx.documents.length}):`,
    ctx.documents.map((d, i) => `${i + 1}. ${d.originalFilename} (${d.type})`).join("\n"),
    "",
    `For each ${ctx.visaType} regulatory criterion, rule: is it met (boolean)? Provide a rationale citing the evidence plan + the specific exhibits (by filename) that support the ruling. Be honest about close calls — if the evidence is weak, mark met=false even if the attorney would argue otherwise (better the attorney sees the gap now). Return JSON matching the provided schema.`,
  ].join("\n");

  return {
    systemPrompt: buildSystemPrompt(ctx.visaType),
    userPrompt,
    jsonSchema: {
      name: "criteria_analysis",
      schema: CRITERIA_ANALYSIS_JSON_SCHEMA,
    },
    searchPolicy: { mode: "academic" },
    maxTokens: 4000,
  };
}

const CRITERIA_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  required: ["visaType", "metCount", "requiredCount", "items"],
  additionalProperties: false,
  properties: {
    visaType: { type: "string" },
    metCount: { type: "integer", minimum: 0 },
    requiredCount: { type: "integer", minimum: 0 },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["criterion", "met", "rationale", "supportingExhibits"],
        additionalProperties: false,
        properties: {
          criterion: { type: "string" },
          met: { type: "boolean" },
          rationale: { type: "string" },
          supportingExhibits: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
