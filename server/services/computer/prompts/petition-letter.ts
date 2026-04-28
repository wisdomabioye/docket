import "server-only";
import { buildSystemPrompt } from "./system";
import type { BuildContext, PromptSpec } from "./context";

/**
 * Petition letter — the attorney's brief to USCIS arguing the
 * beneficiary qualifies. Highest-stakes output in the package.
 *
 * Web search ENABLED with a strict domain allowlist. The model can
 * reference USCIS regulations and AAO precedents (lock the search to
 * authoritative sources so it can't drag in random commentary). The
 * disclaimer + system prompt's "no fabricated citations" rule remain
 * the gate; this just narrows what's reachable.
 */
const PETITION_LETTER_DOMAINS = [
  "uscis.gov",
  "justice.gov",
  "aao.uscis.gov",
  "law.cornell.edu",
  "ecfr.gov",
] as const;

export function buildPetitionLetterPrompt(ctx: BuildContext): PromptSpec {
  if (!ctx.evidencePlan) {
    throw new Error(
      "buildPetitionLetterPrompt: evidencePlan must be populated; this prompt argues against the criteria the evidence plan assessed.",
    );
  }

  const userPrompt = [
    `Visa type: ${ctx.visaType}`,
    `Beneficiary: ${ctx.beneficiary.fullName ?? "(name not provided)"}`,
    `Occupation: ${ctx.beneficiary.occupation ?? "(not provided)"}`,
    `Nationality: ${ctx.beneficiary.nationality ?? "(not provided)"}`,
    "",
    "Evidence plan (from prior step):",
    JSON.stringify(ctx.evidencePlan, null, 2),
    "",
    `Documents uploaded (${ctx.documents.length}):`,
    ctx.documents.map((d, i) => `${i + 1}. ${d.originalFilename} (${d.type})`).join("\n"),
    "",
    `Draft the petition letter to USCIS. Structure: caption (Re: ${ctx.visaType} petition for ${ctx.beneficiary.fullName ?? "[Beneficiary]"}); brief introduction (one paragraph stating who the beneficiary is and what the petition seeks); per-criterion argument (only the criteria the evidence plan assessed as strong or moderate); evidentiary citations (Exhibit A, B, C... mapped to uploaded documents); conclusion. Around 4000-6000 words. Use formal letter style; cite USCIS regulations and AAO precedents only when you are certain they exist (when in doubt, describe the principle without a citation).`,
  ].join("\n");

  return {
    systemPrompt: buildSystemPrompt(ctx.visaType),
    userPrompt,
    searchPolicy: {
      mode: "web",
      domainAllowlist: PETITION_LETTER_DOMAINS,
    },
    maxTokens: 12000,
  };
}
