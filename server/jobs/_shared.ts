import "server-only";
import { NonRetriableError } from "inngest";
import { db, type Db } from "@/server/db/client";
import { saveOutputVersion } from "@/server/services/output";
import { getComputerClient } from "@/server/services/computer/factory";
import {
  ComputerError,
  type ComputerInput,
  type ComputerOutput,
  type OutputType,
} from "@/server/services/computer/types";
import type { PromptSpec } from "@/server/services/computer/prompts/context";
import { isAppError } from "@/lib/errors";

/**
 * Shared per-output runner. The 5 sub-functions (evidence-plan,
 * personal-statement, petition-letter, recommendation-letter,
 * exhibit-index) all do the same shape:
 *
 *   1. Build a `ComputerInput` from a `PromptSpec` + telemetry metadata.
 *   2. Call `getComputerClient().generate(input)` — long-running, OUTSIDE
 *      any DB transaction.
 *   3. Open a transaction and `saveOutputVersion` the result. The
 *      transaction handles budget guard, version bump, and ledger write
 *      atomically (Stage 7 contract).
 *
 * Errors get classified for Inngest:
 *   - `ComputerError` with `retryable=false` → throw `NonRetriableError`
 *     so Inngest skips retries (e.g. `InvalidInput`, `NotConfigured`,
 *     `BudgetExceeded`).
 *   - `AppError("BAD_REQUEST")` from `saveOutputVersion` (budget exceeded
 *     or invalid metadata) → also `NonRetriableError`. The parent build
 *     job sees the failure and transitions the case to `draft_ready`
 *     (partial) or `build_failed` per the parent's policy.
 *   - Everything else propagates so Inngest's per-function `retries`
 *     setting decides.
 *
 * Steps run via `step.run` in the caller; this function is the single
 * unit of work executed inside one step. Splitting generate + save into
 * two `step.run` calls would double the step count for no replay benefit
 * — the generate result isn't reusable across runs (cost is sunk on
 * each Sonar call regardless of replay).
 */

export type RunOutputJobArgs = {
  caseId: string;
  outputType: OutputType;
  prompt: PromptSpec;
  /** Stable id used for log correlation. Pass the Inngest `event.id` or
   *  a derivative; Sonar's response id supersedes this in saved metadata. */
  sessionId: string;
  /** Extra fields merged into `case_outputs.metadata`. The runner stamps
   *  `type` (= outputType), model, finishReason, citations, searchResults,
   *  provider, sessionId on top automatically. Use this for typed-branch
   *  fields like `recommenderName` on `recommendation_letter_template`. */
  extraMetadata?: Record<string, unknown>;
};

export type RunOutputJobResult = {
  outputId: string;
  outputVersion: number;
  /** Stringified bigint — Inngest serializes step results via JSON and
   *  `JSON.stringify(bigint)` throws. Parent decodes with `BigInt(s)` if
   *  it needs the typed value; otherwise compare as string. */
  newSpendCents: string;
  /** USD cents this single call cost — `number` is safe (per-call cost
   *  rounds to cents and stays well under `Number.MAX_SAFE_INTEGER`). */
  costCents: number;
  computerSessionId: string;
};

export async function runOutputJob(
  args: RunOutputJobArgs,
): Promise<RunOutputJobResult> {
  const { caseId, outputType, prompt, sessionId, extraMetadata } = args;

  const input: ComputerInput = {
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    ...(prompt.jsonSchema ? { jsonSchema: prompt.jsonSchema } : {}),
    ...(prompt.searchPolicy ? { searchPolicy: prompt.searchPolicy } : {}),
    ...(prompt.maxTokens !== undefined ? { maxTokens: prompt.maxTokens } : {}),
    metadata: { caseId, outputType, sessionId },
  };

  const startedAt = Date.now();
  let out: ComputerOutput;
  try {
    out = await getComputerClient().generate(input);
  } catch (err) {
    throw classifyForInngest(err, `generate ${outputType}`);
  }
  const computeDurationMs = Date.now() - startedAt;

  // Field-precedence rule: caller's `extraMetadata` is for typed-branch
  // fields (e.g. `recommenderName` on `recommendation_letter_template`),
  // NOT for overriding the runner's authoritative attribution. So
  // `provider` + `sessionId` come last and win — a caller can't
  // accidentally rewrite the cost/audit trail by reusing those names.
  const metadata: Record<string, unknown> = {
    ...(out.metadata ?? {}),
    ...(out.citations ? { citations: out.citations } : {}),
    ...(out.searchResults ? { searchResults: out.searchResults } : {}),
    ...(extraMetadata ?? {}),
    provider: out.provider,
    sessionId: out.sessionId,
  };

  try {
    const result = await db.transaction(async (tx) =>
      saveOutputVersion({
        // `PgTransaction` doesn't structurally satisfy `Db` (missing
        // `$client`); same cast as `trpc.ts` uses for the transactional
        // `ctx.db`. saveOutputVersion only ever calls Drizzle query
        // methods, which both shapes implement identically.
        tx: tx as unknown as Db,
        caseId,
        outputType,
        content: out.text,
        metadata,
        computerSessionId: out.sessionId,
        computeDurationMs,
        promptTokens: out.usage.promptTokens,
        completionTokens: out.usage.completionTokens,
        usdCents: out.usage.usdCents,
      }),
    );
    return {
      outputId: result.outputId,
      outputVersion: result.outputVersion,
      newSpendCents: result.newSpendCents.toString(),
      costCents: out.usage.usdCents,
      computerSessionId: out.sessionId,
    };
  } catch (err) {
    throw classifyForInngest(err, `save ${outputType}`);
  }
}

/** Map a service-layer error to either `NonRetriableError` (so Inngest
 *  short-circuits retries) or pass through (Inngest's `retries` config
 *  decides). The wrapped message includes a phase tag so log search can
 *  separate generate-time vs save-time failures. */
function classifyForInngest(err: unknown, phase: string): Error {
  if (err instanceof ComputerError && !err.retryable) {
    return new NonRetriableError(
      `[${phase}] ComputerError(${err.code}): ${err.message}`,
      { cause: err },
    );
  }
  if (isAppError(err) && err.code === "BAD_REQUEST") {
    return new NonRetriableError(`[${phase}] ${err.message}`, { cause: err });
  }
  // AppError("NOT_FOUND") on the case row, or any non-AppError, propagates
  // for Inngest to retry per function policy.
  if (err instanceof Error) return err;
  return new Error(`[${phase}] ${String(err)}`);
}

/** Shared concurrency policy for every output sub-function: serialize
 *  per-case so two builds for the same case can't race the same output
 *  type. The CEL expression reads `event.data.caseId` at trigger time. */
export const OUTPUT_JOB_CONCURRENCY = {
  key: "event.data.caseId",
  limit: 1,
} as const;
