import "server-only";
import { eventType, staticSchema } from "inngest";
import { inngest } from "./client";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { buildPersonalStatementPrompt } from "@/server/services/computer/prompts";
import type { BuildContext } from "@/server/services/computer/prompts/context";

/**
 * Personal statement — first-person prose drafted from intake + the
 * upstream evidence-plan output. Parent must include the populated
 * `evidencePlan` in `ctx`; the prompt builder asserts it.
 */

export const personalStatementRequested = eventType(
  "case/output.personal-statement.requested",
  {
    schema: staticSchema<{ caseId: string; ctx: BuildContext }>(),
  },
);

export const outputPersonalStatement = inngest.createFunction(
  {
    id: "output-personal-statement",
    concurrency: OUTPUT_JOB_CONCURRENCY,
    retries: 2,
    triggers: [{ event: personalStatementRequested }],
  },
  async ({ event, step }) => {
    const { caseId, ctx } = event.data;
    return await step.run("generate-and-save", async () =>
      runOutputJob({
        caseId,
        outputType: "personal_statement",
        prompt: buildPersonalStatementPrompt(ctx),
        sessionId: event.id ?? `personal-statement-${caseId}`,
      }),
    );
  },
);
