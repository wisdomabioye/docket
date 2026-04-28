/** Barrel for prompt builders. Each builder is a pure function returning
 *  a `PromptSpec` (system + user prompt + optional JSON schema + search
 *  policy). Sub-functions in `server/jobs/*` consume these. */

export { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "./system";
export { buildEvidencePlanPrompt } from "./evidence-plan";
export { buildPersonalStatementPrompt } from "./personal-statement";
export { buildPetitionLetterPrompt } from "./petition-letter";
export {
  buildRecommendationLetterPrompt,
} from "./recommendation-letter";
export { buildExhibitIndexPrompt } from "./exhibit-index";
export { buildCriteriaAnalysisPrompt } from "./criteria-analysis";

export type {
  BuildContext,
  BuildContextDocument,
  Recommender,
  PromptSpec,
} from "./context";
