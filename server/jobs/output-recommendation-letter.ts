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
 * NOTE on multi-recommender semantics (open_issues #20): every recommender
 * letter writes a `recommendation_letter_template` row. `saveOutputVersion`
 * flips prior `is_current=true` rows to `false`, so only the most recently
 * saved letter is `is_current`. Stage 8 needs to either (a) introduce a
 * per-recommender stable id on `case_outputs`, (b) bundle all letters into
 * one output, or (c) relax the is_current invariant for this type. Phase 9
 * accepts the lossy behavior; the version history retains all letters.
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
