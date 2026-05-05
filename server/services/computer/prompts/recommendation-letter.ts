import "server-only";
import { buildSystemPrompt } from "./system";
import type { BuildContext, PromptSpec, Recommender } from "./context";

/**
 * Recommendation letter template — drafted in the recommender's voice.
 * One call per recommender (parent fans out via Inngest's parallel
 * pattern, one sub-event per `Recommender` in `ctx.recommenders`).
 *
 * Output is a TEMPLATE the attorney sends to the recommender; the
 * recommender edits + signs. Search disabled — the recommender's
 * authority comes from their own credentials, not web grounding.
 */
export function buildRecommendationLetterPrompt(
  ctx: BuildContext,
  recommender: Recommender,
): PromptSpec {
  if (!ctx.evidencePlan) {
    throw new Error(
      "buildRecommendationLetterPrompt: evidencePlan must be populated; the letter references the criteria the recommender is best-positioned to speak to.",
    );
  }

  const userPrompt = [
    `Visa type: ${ctx.visaType}`,
    `Beneficiary: ${ctx.beneficiary.fullName ?? "(name not provided)"}`,
    `Occupation: ${ctx.beneficiary.occupation ?? "(not provided)"}`,
    "",
    `Recommender: ${recommender.fullName}`,
    `Recommender's role: ${recommender.role || "(not provided)"}`,
    `Relationship to beneficiary: ${recommender.relationship}`,
    recommender.guidance
      ? `Attorney's guidance for this letter: ${recommender.guidance}`
      : "",
    "",
    "Evidence plan summary (criteria the recommender is best-positioned to speak to):",
    summarizeEvidencePlan(ctx.evidencePlan),
    "",
    `Draft a recommendation letter from ${recommender.fullName} on behalf of ${ctx.beneficiary.fullName ?? "the beneficiary"}. Use the recommender's voice (first-person from the recommender). Cover: how they know the beneficiary, what specific work or qualities they can attest to (anchored in the evidence plan's strong criteria for which they have direct knowledge), and an explicit endorsement of the petition. Around 800-1500 words. Plain prose; salutation + signature block.`,
    "",
    "This is a TEMPLATE the attorney will send to the recommender for review and signature; do not impersonate the recommender's specific opinions where they aren't supported by the relationship described. Use bracketed placeholders [LIKE THIS] for any specific dates, projects, or claims the recommender should fill in or verify.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    systemPrompt: buildSystemPrompt(ctx.visaType),
    userPrompt,
    searchPolicy: { mode: "disabled" },
    maxTokens: 4000,
  };
}

function summarizeEvidencePlan(plan: NonNullable<BuildContext["evidencePlan"]>): string {
  return plan.criteria
    .filter((c) => c.assessment === "strong" || c.assessment === "moderate")
    .map((c) => `- ${c.criterion} (${c.assessment}): ${c.summary.slice(0, 300)}`)
    .join("\n") || "(no strong/moderate criteria in evidence plan — letter scope will be limited)";
}
