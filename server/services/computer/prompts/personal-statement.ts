import "server-only";
import { buildSystemPrompt } from "./system";
import type { BuildContext, PromptSpec } from "./context";

/**
 * Personal statement — first-person narrative the beneficiary will sign.
 *
 * Search disabled: this output is grounded entirely in the beneficiary's
 * own story (intake + uploaded CV/resume). Web grounding here would
 * inject claims the attorney has to manually scrub. Sonar's prose model
 * works fine without search for narrative drafting.
 */
export function buildPersonalStatementPrompt(ctx: BuildContext): PromptSpec {
  if (!ctx.evidencePlan) {
    throw new Error(
      "buildPersonalStatementPrompt: evidencePlan must be populated; this prompt depends on the prior evidence-plan output.",
    );
  }
  const cvSnippet = ctx.documents
    .filter((d) => d.type === "cv_resume")
    .map((d) => d.extractedText)
    .join("\n\n")
    .slice(0, 4000);

  const userPrompt = [
    `Visa type: ${ctx.visaType}`,
    `Beneficiary: ${ctx.beneficiary.fullName ?? "(name not provided)"}`,
    `Nationality: ${ctx.beneficiary.nationality ?? "(not provided)"}`,
    `Occupation: ${ctx.beneficiary.occupation ?? "(not provided)"}`,
    "",
    "Evidence plan (from prior step):",
    JSON.stringify(ctx.evidencePlan, null, 2),
    "",
    cvSnippet ? `CV/résumé excerpt:\n${cvSnippet}` : "(no CV uploaded)",
    "",
    "Beneficiary intake notes:",
    ctx.beneficiary.notes ?? "(none)",
    "",
    "Draft a first-person personal statement the beneficiary will sign. Cover: their background, their key achievements (anchored in the evidence plan's strong criteria), why their work qualifies under the visa criteria, and their planned activities in the U.S. Around 1500-2500 words. Plain prose; no headings.",
  ].join("\n");

  return {
    systemPrompt: buildSystemPrompt(ctx.visaType),
    userPrompt,
    searchPolicy: { mode: "disabled" },
    maxTokens: 6000,
  };
}
