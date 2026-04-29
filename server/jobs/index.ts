import "server-only";
import type { InngestFunction } from "inngest";
import { outputEvidencePlan } from "./output-evidence-plan";
import { outputPersonalStatement } from "./output-personal-statement";
import { outputPetitionLetter } from "./output-petition-letter";
import { outputRecommendationLetter } from "./output-recommendation-letter";
import { outputExhibitIndex } from "./output-exhibit-index";
import { computerHealth } from "./computer-health";
import { caseBuildFailed } from "./case-build-failed";

/**
 * Registry of every Inngest function the app serves. The `serve()` route
 * handler imports this single array — adding a new job means appending
 * here, never touching the route handler.
 *
 * Phase 9 registers:
 *   - 5 per-output sub-functions (one per `output_type` triggered)
 *   - `computer-health` cron (every 5 min, writes Redis + emits degraded)
 *   - `case-build-failed` listener (logging stub; Stage 11 wires email)
 *
 * Phase 10 will add the parent `case-build` orchestrator and
 * `regenerate-output` single-call rerun.
 */

export const inngestFunctions: ReadonlyArray<InngestFunction.Any> = [
  outputEvidencePlan,
  outputPersonalStatement,
  outputPetitionLetter,
  outputRecommendationLetter,
  outputExhibitIndex,
  computerHealth,
  caseBuildFailed,
];
