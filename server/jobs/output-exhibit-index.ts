import "server-only";
import { eventType, staticSchema } from "inngest";
import { inngest } from "./client";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { buildExhibitIndexPrompt } from "@/server/services/computer/prompts";
import type { BuildContext } from "@/server/services/computer/prompts/context";

/**
 * Exhibit index — structured table of contents over the uploaded
 * documents. Last in the pipeline; depends only on the document list,
 * not on the prose outputs.
 */

export const exhibitIndexRequested = eventType(
  "case/output.exhibit-index.requested",
  {
    schema: staticSchema<{ caseId: string; ctx: BuildContext }>(),
  },
);

export const outputExhibitIndex = inngest.createFunction(
  {
    id: "output-exhibit-index",
    concurrency: OUTPUT_JOB_CONCURRENCY,
    retries: 2,
    triggers: [{ event: exhibitIndexRequested }],
  },
  async ({ event, step }) => {
    const { caseId, ctx } = event.data;
    return await step.run("generate-and-save", async () =>
      runOutputJob({
        caseId,
        outputType: "exhibit_index",
        prompt: buildExhibitIndexPrompt(ctx),
        sessionId: event.id ?? `exhibit-index-${caseId}`,
        extraMetadata: {
          // Satisfies the typed `ExhibitIndexMetadata` branch — count of
          // documents the index was built from. Stage 8 review UI shows
          // this in the version selector.
          exhibitCount: ctx.documents.length,
        },
      }),
    );
  },
);
