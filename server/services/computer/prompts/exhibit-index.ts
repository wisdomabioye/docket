import "server-only";
import { z } from "zod";
import { buildSystemPrompt } from "./system";
import { snippet } from "./_shared";
import type { BuildContext, PromptSpec } from "./context";

/**
 * Exhibit index — the structured table-of-evidence the petition letter
 * references (Exhibit A, B, C ...). Search disabled: this is a
 * descriptive listing of attorney-uploaded documents; web grounding
 * adds no value.
 *
 * Structured output. Each entry maps one uploaded document to an
 * exhibit label + which evidence-plan criteria it supports.
 */
export function buildExhibitIndexPrompt(ctx: BuildContext): PromptSpec {
  if (!ctx.evidencePlan) {
    throw new Error(
      "buildExhibitIndexPrompt: evidencePlan must be populated; the index labels each exhibit by which criteria it supports.",
    );
  }

  const userPrompt = [
    `Visa type: ${ctx.visaType}`,
    `Beneficiary: ${ctx.beneficiary.fullName ?? "(name not provided)"}`,
    "",
    `Documents uploaded (${ctx.documents.length}):`,
    ctx.documents
      .map(
        (d, i) =>
          `${i + 1}. [${d.type}] ${d.originalFilename}${d.truncated ? " (truncated)" : ""}\n   Excerpt: ${snippet(d.extractedText, 400)}`,
      )
      .join("\n\n"),
    "",
    "Evidence plan criteria:",
    ctx.evidencePlan.criteria
      .map((c) => `- ${c.criterion} (${c.assessment})`)
      .join("\n"),
    "",
    "Build the exhibit index. Assign each document an exhibit label (Exhibit A, Exhibit B, ...), describe the document briefly (one to two sentences), and list which criteria from the evidence plan it supports. Return JSON matching the provided schema.",
  ].join("\n");

  return {
    systemPrompt: buildSystemPrompt(ctx.visaType),
    userPrompt,
    jsonSchema: {
      name: "exhibit_index",
      schema: EXHIBIT_INDEX_JSON_SCHEMA,
    },
    searchPolicy: { mode: "disabled" },
    maxTokens: 3000,
  };
}

/** Local Zod schema for the exhibit index — the canonical type isn't
 *  defined elsewhere yet (Stage 8 may move it to `case_outputs.metadata`
 *  per-type schema). Defined here so the JSON Schema sent to Sonar and
 *  the eventual `JSON.parse(...)` validator stay in sync via one source. */
export const ExhibitIndexEntrySchema = z
  .object({
    label: z.string(), // "Exhibit A"
    documentId: z.string(),
    filename: z.string(),
    description: z.string(),
    supportsCriteria: z.array(z.string()),
  })
  .strict();

export const ExhibitIndexSchema = z
  .object({
    entries: z.array(ExhibitIndexEntrySchema),
  })
  .strict();

const EXHIBIT_INDEX_JSON_SCHEMA = z.toJSONSchema(ExhibitIndexSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;
