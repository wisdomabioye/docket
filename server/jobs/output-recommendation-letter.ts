import "server-only";
import { eventType, staticSchema } from "inngest";
import { inngest } from "./client";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { buildRecommendationLetterPrompt } from "@/server/services/computer/prompts";
import type {
  BuildContext,
  Recommender,
} from "@/server/services/computer/prompts/context";

/**
 * Recommendation-letter template — drafted in the recommender's voice.
 * Parent fans out one event per `Recommender` in `ctx.recommenders`, so
 * this function carries a single `recommender` in the payload.
 *
 * Multi-recommender semantics (resolved in Stage 08, migration 0012):
 * each recommender's letter occupies its own `(case, type, subgroupKey)`
 * bucket via `subgroupKey = recommender.id`. The partial unique indexes
 * on `case_outputs` use `COALESCE(subgroup_key, '')`, so each recommender's
 * letter has an independent `is_current` + version chain. Closes #20.
 */

export const recommendationLetterRequested = eventType(
  "case/output.recommendation-letter.requested",
  {
    schema: staticSchema<{
      caseId: string;
      ctx: BuildContext;
      recommender: Recommender;
    }>(),
  },
);

export const outputRecommendationLetter = inngest.createFunction(
  {
    id: "output-recommendation-letter",
    concurrency: OUTPUT_JOB_CONCURRENCY,
    retries: 2,
    triggers: [{ event: recommendationLetterRequested }],
  },
  async ({ event, step }) => {
    const { caseId, ctx, recommender } = event.data;
    return await step.run(
      // Recommender id in the step name keeps two letters for the same
      // case from sharing a memoized step result if Inngest replays.
      `generate-and-save-${recommender.id}`,
      async () =>
        runOutputJob({
          caseId,
          outputType: "recommendation_letter_template",
          subgroupKey: recommender.id,
          prompt: buildRecommendationLetterPrompt(ctx, recommender),
          sessionId: event.id ?? `rec-letter-${caseId}-${recommender.id}`,
          extraMetadata: {
            // Satisfies the typed `RecommendationLetterMetadata` branch
            // of `OutputMetadataSchema` — fields go into the saved row's
            // `metadata` jsonb.
            recommenderName: recommender.fullName,
            recommenderTitle: recommender.role,
            recommenderRelationship: recommender.relationship,
          },
        }),
    );
  },
);
