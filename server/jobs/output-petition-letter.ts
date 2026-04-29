import "server-only";
import { eventType, staticSchema } from "inngest";
import { inngest } from "./client";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { buildPetitionLetterPrompt } from "@/server/services/computer/prompts";
import type { BuildContext } from "@/server/services/computer/prompts/context";

/**
 * Petition letter — the long-form legal argument. Highest-stakes output;
 * the prompt's web-search policy is locked to USCIS-adjacent domains so
 * citations stay grounded.
 */

export const petitionLetterRequested = eventType(
  "case/output.petition-letter.requested",
  {
    schema: staticSchema<{ caseId: string; ctx: BuildContext }>(),
  },
);

export const outputPetitionLetter = inngest.createFunction(
  {
    id: "output-petition-letter",
    concurrency: OUTPUT_JOB_CONCURRENCY,
    retries: 2,
    triggers: [{ event: petitionLetterRequested }],
  },
  async ({ event, step }) => {
    const { caseId, ctx } = event.data;
    return await step.run("generate-and-save", async () =>
      runOutputJob({
        caseId,
        outputType: "petition_letter",
        prompt: buildPetitionLetterPrompt(ctx),
        sessionId: event.id ?? `petition-letter-${caseId}`,
      }),
    );
  },
);
