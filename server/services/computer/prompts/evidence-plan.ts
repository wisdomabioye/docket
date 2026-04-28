import "server-only";
import { buildSystemPrompt } from "./system";
import type { BuildContext, PromptSpec } from "./context";

/**
 * Evidence plan — first output in the pipeline. Surveys what the
 * attorney has uploaded against the visa's regulatory criteria and
 * outputs a structured per-criterion assessment that feeds every
 * downstream output.
 *
 * Structured output (JSON schema). Mirrors `EvidencePlanSchema` so the
 * sub-function can `EvidencePlanSchema.parse(JSON.parse(text))` without
 * a separate adapter.
 */
export function buildEvidencePlanPrompt(ctx: BuildContext): PromptSpec {
  const docList = ctx.documents
    .map(
      (d, i) =>
        `${i + 1}. [${d.type}] ${d.originalFilename}${d.truncated ? " (truncated)" : ""}\n${snippet(d.extractedText, 800)}`,
    )
    .join("\n\n");

  const userPrompt = [
    `Visa type: ${ctx.visaType}`,
    `Beneficiary: ${ctx.beneficiary.fullName ?? "(name not provided at intake)"}`,
    `Occupation: ${ctx.beneficiary.occupation ?? "(not provided)"}`,
    `Nationality: ${ctx.beneficiary.nationality ?? "(not provided)"}`,
    "",
    "Documents uploaded by attorney (excerpts shown):",
    docList || "(no documents uploaded)",
    "",
    `Produce an evidence plan: for each ${ctx.visaType} regulatory criterion, assess whether the uploaded evidence supports it (strong/moderate/weak/absent), summarize what's there, list specific gaps the attorney should address, and recommend next steps. Return JSON matching the provided schema.`,
  ].join("\n");

  return {
    systemPrompt: buildSystemPrompt(ctx.visaType),
    userPrompt,
    jsonSchema: {
      name: "evidence_plan",
      schema: EVIDENCE_PLAN_JSON_SCHEMA,
    },
    // Web-grounded but no domain lock — useful for surfacing typical
    // evidence shapes from past O-1A / EB-1A petitions discussed online.
    searchPolicy: { mode: "web" },
    maxTokens: 4096,
  };
}

/** First N chars + ellipsis. Used to keep doc excerpts in the prompt
 *  brief; full extracted text lives in the case_documents row. */
function snippet(s: string, n: number): string {
  if (!s) return "(no extracted text)";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Mirrors `EvidencePlanSchema` from server/db/schema/zod/. Hand-rolled
 *  JSON Schema so we don't pull in zod-to-json-schema as a dep just
 *  for prompt construction. */
const EVIDENCE_PLAN_JSON_SCHEMA = {
  type: "object",
  required: ["visaType", "overallStrength", "criteria", "generatedAt"],
  additionalProperties: false,
  properties: {
    visaType: { type: "string" },
    overallStrength: { type: "string", enum: ["strong", "moderate", "weak"] },
    criteria: {
      type: "array",
      items: {
        type: "object",
        required: ["criterion", "assessment", "summary", "gaps"],
        additionalProperties: false,
        properties: {
          criterion: { type: "string" },
          assessment: {
            type: "string",
            enum: ["strong", "moderate", "weak", "absent"],
          },
          summary: { type: "string" },
          gaps: { type: "array", items: { type: "string" } },
          recommendation: { type: "string" },
        },
      },
    },
    generatedAt: { type: "string", format: "date-time" },
  },
} as const;
