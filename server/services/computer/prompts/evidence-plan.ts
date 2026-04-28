import "server-only";
import { z } from "zod";
import { EvidencePlanSchema } from "@/server/db/schema/zod";
import { buildSystemPrompt } from "./system";
import { snippet } from "./_shared";
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

/** Derived from the canonical `EvidencePlanSchema` (Zod) — single source
 *  of truth. Adding a field to the Zod schema picks it up here on the
 *  next request. `target: "draft-2020-12"` matches what OpenAI-style
 *  `response_format` JSON Schema expects. */
const EVIDENCE_PLAN_JSON_SCHEMA = z.toJSONSchema(EvidencePlanSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;
