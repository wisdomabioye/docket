import "server-only";
import type { InngestFunction } from "inngest";
import { outputEvidencePlan } from "./output-evidence-plan";
import { outputPersonalStatement } from "./output-personal-statement";
import { outputPetitionLetter } from "./output-petition-letter";
import { outputRecommendationLetter } from "./output-recommendation-letter";
import { outputExhibitIndex } from "./output-exhibit-index";
import { computerHealth } from "./computer-health";
import { caseBuild } from "./case-build";
import { regenerateOutput } from "./regenerate-output";
import { caseBuildWatchdog } from "./case-build-watchdog";
import { notificationFunctions } from "@/server/services/email/notifications";

/**
 * Registry of every Inngest function the app serves. The `serve()` route
 * handler imports this single array — adding a new job means appending
 * here, never touching the route handler.
 *
 * Phase 9 registered:
 *   - 5 per-output sub-functions (one per `output_type` triggered)
 *   - `computer-health` cron (every 5 min, writes Redis + emits degraded)
 *
 * Phase 10 adds:
 *   - `case-build` parent orchestrator (fans out evidence-plan → others)
 *   - `regenerate-output` single-output rerun (Stage 8 review UI hook)
 *   - `case-build-watchdog` cron (every 5 min, kills stuck builds > 30m)
 *
 * Stage 11 / PM.4 adds:
 *   - 8 notification listeners under `services/email/notifications/`.
 *     Two of them (case-build-completed, case-build-failed) subscribe to
 *     the existing `case/build.completed` / `case/build.failed` domain
 *     events, replacing the prior logging-only `case-build-failed` stub.
 *     The other six subscribe to dedicated `notification/*` events
 *     emitted by the mutations + jobs wired in PM.5.
 */

export const inngestFunctions: ReadonlyArray<InngestFunction.Any> = [
  outputEvidencePlan,
  outputPersonalStatement,
  outputPetitionLetter,
  outputRecommendationLetter,
  outputExhibitIndex,
  computerHealth,
  caseBuild,
  regenerateOutput,
  caseBuildWatchdog,
  ...notificationFunctions,
];
