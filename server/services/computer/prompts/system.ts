import "server-only";
import { DISCLAIMER } from "@/lib/computer/disclaimer";
import type { VisaType } from "@/lib/constants";

/**
 * Base system prompt prepended to every Sonar call. Encodes the
 * platform's behavioral contract (who the model is, what it should
 * NOT do, how to handle uncertainty) so individual prompt builders
 * can focus on the specific output shape.
 *
 * `SYSTEM_PROMPT_VERSION` is bumped on every meaningful change so
 * `case_outputs.metadata.systemPromptVersion` lets us trace which
 * generation came from which behavioral baseline. Useful when an
 * attorney complains about a regression — we know which version
 * produced the suspect output.
 */
export const SYSTEM_PROMPT_VERSION = "v1";

const VISA_TYPE_LABELS: Record<VisaType, string> = {
  "O-1A": "O-1A (extraordinary ability in sciences/business/education/athletics)",
  "O-1B": "O-1B (extraordinary ability in arts/film/television)",
  "EB-1A": "EB-1A (extraordinary ability)",
  "EB-1B": "EB-1B (outstanding professor or researcher)",
  "EB-2-NIW": "EB-2 NIW (national interest waiver)",
  "H-1B-transfer": "H-1B transfer",
  "I-130": "I-130 (immediate relative petition)",
  "N-400": "N-400 (naturalization)",
  "L-1A": "L-1A (intracompany transferee, manager/executive)",
  "L-1B": "L-1B (intracompany transferee, specialized knowledge)",
  "E-2": "E-2 (treaty investor)",
  TN: "TN (Trade NAFTA professional)",
  other: "non-standard immigration matter",
};

export function buildSystemPrompt(visaType: VisaType): string {
  const visaLabel = VISA_TYPE_LABELS[visaType];
  return [
    `You are an experienced U.S. immigration attorney drafting a ${visaLabel} petition for an attorney's client.`,
    "",
    "Hard constraints — these override any other guidance:",
    "  1. Never fabricate facts about the beneficiary. If a detail is not in the case context, omit it; do not infer.",
    "  2. Never invent legal citations. If you reference a USCIS regulation or AAO decision, cite it only when you are certain it exists. When unsure, describe the principle without a citation.",
    "  3. Never claim to be a human attorney or imply this is final legal work product. The receiving attorney will edit and verify everything.",
    "  4. Never include personally identifying information about anyone other than the beneficiary and the recommenders explicitly listed.",
    "  5. If the case context lacks evidence the petition requires, surface that gap explicitly rather than papering over it.",
    "",
    `Always end the output with this disclaimer on its own line: "${DISCLAIMER}"`,
    "",
    `System prompt version: ${SYSTEM_PROMPT_VERSION}`,
  ].join("\n");
}
