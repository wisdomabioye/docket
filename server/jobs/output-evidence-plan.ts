import "server-only";
import { eventType, staticSchema } from "inngest";
import { inngest } from "./client";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { buildEvidencePlanPrompt } from "@/server/services/computer/prompts";
import type { BuildContext } from "@/server/services/computer/prompts/context";

/**
 * Evidence-plan sub-function. First output in the build pipeline; the
 * parent fans this out before any of the prose outputs because the
 * personal-statement, petition-letter, criteria-analysis, and
 * recommendation-letter prompts read `ctx.evidencePlan` for criterion
 * targeting.
 *
 * Concurrency keyed on `caseId`: at most one evidence-plan generation
 * runs per case at a time, regardless of how many duplicate triggers
 * arrive (handled by the `runOutputJob` helper's idempotent insert is
 * also a fallback safety net).
 */

export const evidencePlanRequested = eventType(
  "case/output.evidence-plan.requested",
  {
    schema: staticSchema<{ caseId: string; ctx: BuildContext }>(),
  },
);

export const outputEvidencePlan = inngest.createFunction(
  {
    id: "output-evidence-plan",
    concurrency: OUTPUT_JOB_CONCURRENCY,
    retries: 2,
    triggers: [{ event: evidencePlanRequested }],
  },
  async ({ event, step }) => {
    const { caseId, ctx } = event.data;
    return await step.run("generate-and-save", async () =>
      runOutputJob({
        caseId,
        outputType: "evidence_plan",
        prompt: buildEvidencePlanPrompt(ctx),
        sessionId: event.id ?? `evidence-plan-${caseId}`,
      }),
    );
  },
);
