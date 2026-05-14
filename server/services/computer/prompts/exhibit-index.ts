import "server-only";
import { z } from "zod";
import {
  ExhibitIndexEntrySchema,
  ExhibitIndexSchema,
} from "@/server/db/schema/zod/exhibit-index";
import { buildSystemPrompt } from "./system";
import { snippet } from "./_shared";
import type { BuildContext, PromptSpec } from "./context";

// Re-export the canonical schemas. They live in `server/db/schema/zod/`
// (no `server-only` marker) so the structured editor can import them
// from a client component. This file's other consumers can keep
// importing `ExhibitIndexSchema` from here unchanged.
export { ExhibitIndexEntrySchema, ExhibitIndexSchema };

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
          `${i + 1}. documentId=${d.id}\n   [${d.type}] ${d.originalFilename}${d.truncated ? " (truncated)" : ""}\n   Excerpt: ${snippet(d.extractedText, 400)}`,
      )
      .join("\n\n"),
    "",
    "Evidence plan criteria:",
    ctx.evidencePlan.criteria
      .map((c) => `- ${c.criterion} (${c.assessment})`)
      .join("\n"),
    "",
    "Build the exhibit index. Assign each document an exhibit label (Exhibit A, Exhibit B, ...), describe the document briefly (one to two sentences), and list which criteria from the evidence plan it supports. Return JSON matching the provided schema.",
    "CRITICAL: each entry's `documentId` MUST be copied verbatim from the `documentId=...` value on the corresponding numbered document above. These are UUIDs — do not invent, renumber, or shorten them. Returning a non-UUID will fail schema validation.",
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

const EXHIBIT_INDEX_JSON_SCHEMA = z.toJSONSchema(ExhibitIndexSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;
