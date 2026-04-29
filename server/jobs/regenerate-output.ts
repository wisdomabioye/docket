import "server-only";
import { eventType, NonRetriableError, staticSchema } from "inngest";
import { and, eq, isNull } from "drizzle-orm";
import { inngest } from "./client";
import { db } from "@/server/db/client";
import { caseOutputs } from "@/server/db/schema";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { loadBuildContext } from "./_context";
import {
  buildEvidencePlanPrompt,
  buildPersonalStatementPrompt,
  buildPetitionLetterPrompt,
  buildExhibitIndexPrompt,
  buildCriteriaAnalysisPrompt,
} from "@/server/services/computer/prompts";
import type {
  BuildContext,
  PromptSpec,
} from "@/server/services/computer/prompts/context";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Single-output rerun. Stage 8's review UI emits this via the
 * `output.regenerate` tRPC procedure when the attorney rejects an
 * output and wants a fresh draft. Bypasses the parent orchestrator —
 * useful when only one output needs another pass and re-running the
 * whole pipeline would burn budget on outputs the attorney already
 * accepted.
 *
 * Recommendation letters are NOT supported here — they need a
 * `Recommender` payload that the review UI doesn't know about until
 * Stage 8 stores recommenders. `output.regenerate` for that type
 * throws `NonRetriableError`. (open_issues #20 tracks the broader
 * recommender-letter semantics.)
 */

export const regenerateOutputRequested = eventType(
  "case/output.regenerate.requested",
  {
    schema: staticSchema<{
      caseId: string;
      outputId: string;
      /** Optional attorney note prepended to the prompt (Stage 8 wires it). */
      guidance?: string;
    }>(),
  },
);

const PROMPT_BUILDERS: Partial<
  Record<OutputType, (ctx: BuildContext) => PromptSpec>
> = {
  evidence_plan: buildEvidencePlanPrompt,
  personal_statement: buildPersonalStatementPrompt,
  petition_letter: buildPetitionLetterPrompt,
  exhibit_index: buildExhibitIndexPrompt,
  criteria_analysis: buildCriteriaAnalysisPrompt,
};

/** Minimal step shape this handler depends on. Lets the test pass an
 *  in-process stub instead of spinning up Inngest's runtime. */
export type RegenerateStep = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
};

/** Body of the `regenerate-output` Inngest function, exported so tests
 *  exercise the real production code path (not a re-derived copy).
 *  Inngest's `createFunction` wrapper only adds id/concurrency/retries
 *  config + serialization; the branching logic + error classification
 *  lives here. */
export async function regenerateOutputHandler(args: {
  caseId: string;
  outputId: string;
  guidance?: string;
  sessionId: string;
  step: RegenerateStep;
}): Promise<ReturnType<typeof runOutputJob>> {
  const { caseId, outputId, guidance, sessionId, step } = args;

  // Look up the row to learn its output type. RLS-bypassing read; we
  // already trust the event source (case.regenerateOutput tRPC, which
  // does its own auth check).
  const outputType = await step.run("load-output-type", async () => {
    const [row] = await db
      .select({ outputType: caseOutputs.outputType })
      .from(caseOutputs)
      .where(
        and(eq(caseOutputs.id, outputId), isNull(caseOutputs.deletedAt)),
      )
      .limit(1);
    if (!row) {
      throw new NonRetriableError(
        `regenerate-output: case_outputs id ${outputId} not found`,
      );
    }
    return row.outputType;
  });

  if (outputType === "recommendation_letter_template") {
    // Needs a Recommender that this event doesn't carry. Stage 8 fix.
    throw new NonRetriableError(
      "regenerate-output: recommendation_letter_template not supported (needs recommender payload — see open_issues #20)",
    );
  }

  const builder = PROMPT_BUILDERS[outputType];
  if (!builder) {
    throw new NonRetriableError(
      `regenerate-output: no prompt builder registered for output type ${outputType}`,
    );
  }

  const ctx = await step.run("load-context", async () =>
    loadBuildContext(caseId),
  );

  const basePrompt = builder(ctx);
  // Guidance is prepended to the user prompt so the model sees it
  // before the rest of the inputs. Empty/undefined guidance yields
  // the unchanged builder output.
  const prompt: PromptSpec = guidance
    ? {
        ...basePrompt,
        userPrompt: `Attorney guidance for this regeneration:\n${guidance}\n\n---\n\n${basePrompt.userPrompt}`,
      }
    : basePrompt;

  return await step.run("generate-and-save", async () =>
    runOutputJob({
      caseId,
      outputType,
      prompt,
      sessionId,
      ...(guidance ? { extraMetadata: { regenerationGuidance: guidance } } : {}),
    }),
  );
}

export const regenerateOutput = inngest.createFunction(
  {
    id: "regenerate-output",
    concurrency: OUTPUT_JOB_CONCURRENCY,
    // Per-call retries match the per-output sub-functions.
    retries: 2,
    triggers: [{ event: regenerateOutputRequested }],
  },
  async ({ event, step }) =>
    regenerateOutputHandler({
      caseId: event.data.caseId,
      outputId: event.data.outputId,
      ...(event.data.guidance !== undefined ? { guidance: event.data.guidance } : {}),
      sessionId: event.id ?? `regen-${event.data.outputId}`,
      // Inngest's `step.run` returns `Promise<Jsonify<T>>` (it serializes
      // results to durable state); our handler treats it as `Promise<T>`.
      // The cast erases the Jsonify wrapper — safe because our step
      // bodies return plain JSON-shaped values (no Date/bigint/Map).
      step: step as unknown as RegenerateStep,
    }),
);
