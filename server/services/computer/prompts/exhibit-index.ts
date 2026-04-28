import "server-only";
import { buildSystemPrompt } from "./system";
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

function snippet(s: string, n: number): string {
  if (!s) return "(no extracted text)";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

const EXHIBIT_INDEX_JSON_SCHEMA = {
  type: "object",
  required: ["entries"],
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "documentId", "filename", "description", "supportsCriteria"],
        additionalProperties: false,
        properties: {
          label: { type: "string" }, // "Exhibit A"
          documentId: { type: "string" },
          filename: { type: "string" },
          description: { type: "string" },
          supportsCriteria: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
