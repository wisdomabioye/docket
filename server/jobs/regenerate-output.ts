import "server-only";
import { eventType, NonRetriableError, staticSchema } from "inngest";
import { and, eq, isNull } from "drizzle-orm";
import { inngest } from "./client";
import { db } from "@/server/db/client";
import { caseOutputs, caseRecommenders } from "@/server/db/schema";
import { OUTPUT_JOB_CONCURRENCY, runOutputJob } from "./_shared";
import { loadBuildContext } from "./_context";
import {
  buildEvidencePlanPrompt,
  buildPersonalStatementPrompt,
  buildPetitionLetterPrompt,
  buildExhibitIndexPrompt,
  buildCriteriaAnalysisPrompt,
  buildRecommendationLetterPrompt,
} from "@/server/services/computer/prompts";
import type {
  BuildContext,
  PromptSpec,
  Recommender,
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
 * Recommendation letters: supported. The output's `subgroupKey` holds
 * the `case_recommenders.id`; we resolve the row, pass it through
 * `buildRecommendationLetterPrompt`, and `runOutputJob` writes the new
 * version into the same `(case, type, subgroupKey)` chain. If the
 * recommender row was removed since the original letter was generated,
 * we surface `NonRetriableError` — the attorney must add a fresh
 * recommender (and consequently a fresh letter) instead.
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

  // Look up the row to learn its output type + subgroup key. The
  // subgroup key is the `case_recommenders.id` for letters, NULL for
  // single-instance outputs. RLS-bypassing read; we already trust the
  // event source (case.regenerateOutput tRPC does its own auth check).
  const outputRow = await step.run("load-output-type", async () => {
    const [row] = await db
      .select({
        outputType: caseOutputs.outputType,
        subgroupKey: caseOutputs.subgroupKey,
      })
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
    return row;
  });
  const { outputType, subgroupKey } = outputRow;

  const ctx = await step.run("load-context", async () =>
    loadBuildContext(caseId),
  );

  // Recommendation letters take a Recommender argument and a different
  // prompt builder signature, so they branch off the generic table.
  if (outputType === "recommendation_letter_template") {
    if (!subgroupKey) {
      throw new NonRetriableError(
        `regenerate-output: recommendation_letter_template ${outputId} has no subgroupKey (recommender id)`,
      );
    }
    const recommender = await step.run("load-recommender", async () =>
      loadRecommender(subgroupKey),
    );
    const basePrompt = buildRecommendationLetterPrompt(ctx, recommender);
    const prompt = applyGuidance(basePrompt, guidance);
    return await step.run("generate-and-save", async () =>
      runOutputJob({
        caseId,
        outputType,
        subgroupKey,
        prompt,
        sessionId,
        extraMetadata: {
          recommenderName: recommender.fullName,
          recommenderTitle: recommender.role,
          recommenderRelationship: recommender.relationship,
          ...(guidance ? { regenerationGuidance: guidance } : {}),
        },
      }),
    );
  }

  const builder = PROMPT_BUILDERS[outputType];
  if (!builder) {
    throw new NonRetriableError(
      `regenerate-output: no prompt builder registered for output type ${outputType}`,
    );
  }

  const prompt = applyGuidance(builder(ctx), guidance);

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

/** Resolve a recommender row into the `Recommender` shape the prompt
 *  builder expects. Throws `NonRetriableError` when the row is missing
 *  or soft-deleted — the attorney removed the recommender after the
 *  letter was first generated; regenerating the same letter no longer
 *  makes sense and the surface error tells them to start fresh. */
async function loadRecommender(recommenderId: string): Promise<Recommender> {
  const [row] = await db
    .select({
      id: caseRecommenders.id,
      fullName: caseRecommenders.fullName,
      titleOrg: caseRecommenders.titleOrg,
      relationship: caseRecommenders.relationship,
      guidance: caseRecommenders.guidance,
    })
    .from(caseRecommenders)
    .where(
      and(
        eq(caseRecommenders.id, recommenderId),
        isNull(caseRecommenders.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new NonRetriableError(
      `regenerate-output: recommender ${recommenderId} no longer exists; remove the stale letter and add a new recommender instead`,
    );
  }
  return {
    id: row.id,
    fullName: row.fullName,
    role: row.titleOrg ?? "",
    relationship: row.relationship,
    guidance: row.guidance,
  };
}

/** Prepend optional attorney guidance to a prompt's user message. */
function applyGuidance(
  basePrompt: PromptSpec,
  guidance: string | undefined,
): PromptSpec {
  if (!guidance) return basePrompt;
  return {
    ...basePrompt,
    userPrompt: `Attorney guidance for this regeneration:\n${guidance}\n\n---\n\n${basePrompt.userPrompt}`,
  };
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
