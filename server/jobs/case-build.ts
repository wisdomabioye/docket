import "server-only";
import { eventType, staticSchema } from "inngest";
import { eq, sql } from "drizzle-orm";
import { inngest } from "./client";
import { db } from "@/server/db/client";
import { caseOutputs, cases } from "@/server/db/schema";
import { transitionCase } from "@/server/services/cases/transition";
import { loadBuildContext, parseEvidencePlanText } from "./_context";
import { outputEvidencePlan } from "./output-evidence-plan";
import { outputPersonalStatement } from "./output-personal-statement";
import { outputPetitionLetter } from "./output-petition-letter";
import { outputExhibitIndex } from "./output-exhibit-index";
import { outputRecommendationLetter } from "./output-recommendation-letter";

/**
 * Parent build orchestrator. Triggered by `case/build.requested` (the
 * `case.requestBuild` tRPC procedure in Phase 11 emits this).
 *
 * Sequence:
 *   1. Load BuildContext (single DB read pass).
 *   2. Transition case → `building` + stamp `build_started_at`.
 *   3. Invoke evidence-plan (must succeed; downstream prompts depend on it).
 *      - On failure: emit `case/build.failed`, transition to `build_failed`,
 *        exit. No partial-success path here — without an evidence plan
 *        the prose outputs would all throw at prompt-build time.
 *   4. Persist the parsed evidence plan to `cases.evidence_plan`.
 *   5. Re-load BuildContext so downstream sub-functions see a populated
 *      `evidencePlan`. (Cheaper than threading the new value through 4
 *      events and risking drift.)
 *   6. Fan out personal-statement, petition-letter, exhibit-index, +
 *      one recommendation-letter per recommender. `Promise.allSettled`-
 *      style error containment: any individual failure becomes a
 *      `{ ok: false, reason }` result rather than killing the parent.
 *   7. Transition case → `draft_ready` if any output succeeded; →
 *      `build_failed` only if every fan-out failed.
 *   8. Stamp `build_completed_at` and emit `case/build.completed`.
 *
 * Concurrency: per-case limit 1. The single-build-per-case invariant is
 * enforced both here and at `case.requestBuild` (Phase 11).
 *
 * Retries: 0 — the sub-functions own retry; re-running the parent would
 * inflate version numbers and double-charge.
 */

export const caseBuildRequested = eventType("case/build.requested", {
  schema: staticSchema<{
    caseId: string;
    /** User who clicked "Build Case" — propagated to `case_events.actor_user_id`. */
    requestedBy: string;
  }>(),
});

export const caseBuildCompletedEvent = eventType("case/build.completed", {
  schema: staticSchema<{
    caseId: string;
    /** True when at least one fan-out output failed. */
    partial: boolean;
    successCount: number;
    failureCount: number;
  }>(),
});

type FanOutResult =
  | { ok: true; outputType: string }
  | { ok: false; outputType: string; reason: string };

export const caseBuild = inngest.createFunction(
  {
    id: "case-build",
    concurrency: { key: "event.data.caseId", limit: 1 },
    retries: 0,
    triggers: [{ event: caseBuildRequested }],
    /**
     * Catches anything the main handler doesn't. Without this, a throw
     * in the persist/finalize/emit steps would leave the case in
     * `building` until the watchdog cron rescues it 30+ minutes later
     * — a bad UX. `onFailure` runs as a separate Inngest function
     * (with its own retries) so a parent crash mid-flight still gets
     * a clean status flip.
     *
     * Status guard: only transitions when the case is still in
     * `building`. If the failure happened AFTER `finalize-status`
     * succeeded (e.g. emit-completed died), the case is already
     * `draft_ready` and we don't clobber it.
     */
    onFailure: async ({ event: failureEvent, error, step: failStep }) => {
      const original = failureEvent.data.event;
      const caseId = original.data.caseId as string;
      const requestedBy = original.data.requestedBy as string;
      const reason = error.message || "case-build orchestrator failed";

      const transitioned = await failStep.run("onfail-transition", async () =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .select({ status: cases.status })
            .from(cases)
            .where(eq(cases.id, caseId))
            .limit(1)
            .for("update");
          if (row?.status !== "building") return false;
          await transitionCase({
            tx: tx as never,
            caseId,
            toStatus: "build_failed",
            actor: { type: "system" },
            reason,
          });
          await tx
            .update(cases)
            .set({ buildCompletedAt: sql`now()` })
            .where(eq(cases.id, caseId));
          return true;
        }),
      );
      if (transitioned) {
        await failStep.sendEvent("onfail-emit", {
          name: "case/build.failed",
          data: { caseId, reason, requestedBy },
        });
      }
    },
  },
  async ({ event, step }) => {
    const { caseId, requestedBy } = event.data;

    // ── 1. Initial context load
    const ctxInitial = await step.run("load-context", async () =>
      loadBuildContext(caseId),
    );

    // ── 2. Transition to building + stamp build_started_at
    await step.run("mark-building", async () =>
      db.transaction(async (tx) => {
        await transitionCase({
          tx: tx as never,
          caseId,
          toStatus: "building",
          actor: { type: "user", userId: requestedBy },
          reason: "case-build orchestrator started",
        });
        await tx
          .update(cases)
          .set({ buildStartedAt: sql`now()`, buildCompletedAt: null })
          .where(eq(cases.id, caseId));
      }),
    );

    // ── 3. Evidence plan (required dependency)
    // Throw on failure: the `onFailure` handler does the canonical
    // cleanup (transition + emit). Wrapping the throw in a descriptive
    // message gives the failure event a meaningful reason.
    const { outputId: evidencePlanOutputId } = await step.invoke(
      "invoke-evidence-plan",
      {
        function: outputEvidencePlan,
        data: { caseId, ctx: ctxInitial },
      },
    );

    // ── 4-5. Persist + reload so ctx.evidencePlan is populated
    const ctxWithPlan = await step.run("persist-evidence-plan", async () => {
      const [row] = await db
        .select({ content: caseOutputs.content })
        .from(caseOutputs)
        .where(eq(caseOutputs.id, evidencePlanOutputId));
      if (!row?.content) {
        throw new Error(
          `evidence-plan row ${evidencePlanOutputId} has no content`,
        );
      }
      const plan = parseEvidencePlanText(row.content);
      await db
        .update(cases)
        .set({ evidencePlan: plan })
        .where(eq(cases.id, caseId));
      return loadBuildContext(caseId);
    });

    // ── 6. Fan-out parallel — partial-failure tolerant.
    // Inline try/catch around each `step.invoke`: extracting a generic
    // `wrapInvoke` helper fights Inngest's `Jsonify<>` step typing
    // (every `step.invoke` resolves to a JSON-mapped result, not the
    // function's raw return type), so the verbose-but-typesafe form
    // wins here over DRY.
    const fanOutPromises: Array<Promise<FanOutResult>> = [
      step
        .invoke("invoke-personal-statement", {
          function: outputPersonalStatement,
          data: { caseId, ctx: ctxWithPlan },
        })
        .then(
          () =>
            ({ ok: true, outputType: "personal_statement" }) as FanOutResult,
          (err: unknown) =>
            ({
              ok: false,
              outputType: "personal_statement",
              reason: err instanceof Error ? err.message : String(err),
            }) as FanOutResult,
        ),
      step
        .invoke("invoke-petition-letter", {
          function: outputPetitionLetter,
          data: { caseId, ctx: ctxWithPlan },
        })
        .then(
          () => ({ ok: true, outputType: "petition_letter" }) as FanOutResult,
          (err: unknown) =>
            ({
              ok: false,
              outputType: "petition_letter",
              reason: err instanceof Error ? err.message : String(err),
            }) as FanOutResult,
        ),
      step
        .invoke("invoke-exhibit-index", {
          function: outputExhibitIndex,
          data: { caseId, ctx: ctxWithPlan },
        })
        .then(
          () => ({ ok: true, outputType: "exhibit_index" }) as FanOutResult,
          (err: unknown) =>
            ({
              ok: false,
              outputType: "exhibit_index",
              reason: err instanceof Error ? err.message : String(err),
            }) as FanOutResult,
        ),
      ...ctxWithPlan.recommenders.map((recommender) =>
        step
          .invoke(`invoke-recommendation-letter-${recommender.id}`, {
            function: outputRecommendationLetter,
            data: { caseId, ctx: ctxWithPlan, recommender },
          })
          .then(
            () =>
              ({
                ok: true,
                outputType: "recommendation_letter_template",
              }) as FanOutResult,
            (err: unknown) =>
              ({
                ok: false,
                outputType: "recommendation_letter_template",
                reason: err instanceof Error ? err.message : String(err),
              }) as FanOutResult,
          ),
      ),
    ];
    const settled = await Promise.all(fanOutPromises);

    const successCount = settled.filter((r) => r.ok).length;
    const failureCount = settled.filter((r) => !r.ok).length;
    const allFailed = successCount === 0;

    // ── 7. Final status transition
    await step.run("finalize-status", async () =>
      db.transaction(async (tx) => {
        await transitionCase({
          tx: tx as never,
          caseId,
          toStatus: allFailed ? "build_failed" : "draft_ready",
          actor: { type: "system" },
          reason: allFailed
            ? `every fan-out failed: ${settled
                .filter((r): r is Extract<FanOutResult, { ok: false }> => !r.ok)
                .map((r) => r.outputType)
                .join(", ")}`
            : `${successCount}/${settled.length} fan-out outputs saved`,
        });
        await tx
          .update(cases)
          .set({ buildCompletedAt: sql`now()` })
          .where(eq(cases.id, caseId));
      }),
    );

    // ── 8. Emit completion (or fall through to build.failed for all-fail)
    if (allFailed) {
      await step.sendEvent("emit-build-failed", {
        name: "case/build.failed",
        data: {
          caseId,
          reason: "every fan-out failed",
          requestedBy,
        },
      });
    } else {
      await step.sendEvent("emit-completed", {
        name: "case/build.completed",
        data: {
          caseId,
          partial: failureCount > 0,
          successCount,
          failureCount,
        },
      });
    }

    return {
      caseId,
      successCount,
      failureCount,
      status: allFailed ? "build_failed" : "draft_ready",
    };
  },
);
