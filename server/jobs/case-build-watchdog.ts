import "server-only";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { inngest } from "./client";
import { db, type Db } from "@/server/db/client";
import { cases } from "@/server/db/schema";
import { markBuildEnded } from "@/server/services/cases/transition";

/**
 * Watchdog cron. Sweeps every 5 minutes for cases stuck in `building`
 * past the SLA. The parent `case-build` function has no per-step
 * timeout — Inngest's default function timeout is generous (hours)
 * and a runaway parent could leave a case in `building` indefinitely.
 *
 * Threshold: 30 minutes. Captures the spec's "Computer down for >4
 * hours → degraded" boundary at the case level (one case is allowed
 * to take a bit, but past 30 min something is wrong) without being
 * so tight that a slow but healthy build gets killed.
 *
 * Each match is moved to `build_failed` and emits `case/build.failed`
 * so the notifier (Stage 11) can alert the attorney. Idempotency:
 * `transitionCase` re-reads the row inside its own tx and rejects an
 * illegal `building → build_failed` if the case meanwhile completed
 * on its own — the watchdog's NOT-FOUND-style check is the row lock
 * inside transitionCase, not a separate guard here.
 */

const STUCK_THRESHOLD_MINUTES = 30;

export const caseBuildWatchdog = inngest.createFunction(
  {
    id: "case-build-watchdog",
    concurrency: { limit: 1 },
    retries: 0,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const stuck = await step.run("find-stuck-cases", async () =>
      db
        .select({
          id: cases.id,
          buildStartedAt: cases.buildStartedAt,
        })
        .from(cases)
        .where(
          and(
            eq(cases.status, "building"),
            isNull(cases.deletedAt),
            // `build_started_at` is null until step 2 of the parent runs.
            // A case stuck before that step would have null → falsy lt
            // comparison → not matched. That's correct: nothing started,
            // nothing to time out. The parent's first action is the
            // status flip + the timestamp stamp in the same tx.
            lt(
              cases.buildStartedAt,
              sql`now() - interval '${sql.raw(`${STUCK_THRESHOLD_MINUTES} minutes`)}'`,
            ),
          ),
        ),
    );

    if (stuck.length === 0) return { swept: 0 };

    let killed = 0;
    for (const row of stuck) {
      // One tx per case so a failure on row N doesn't poison row N+1.
      // Wrapped in step.run so retries (none here, but defensive)
      // don't double-flip a case.
      try {
        await step.run(`kill-${row.id}`, async () =>
          db.transaction(async (tx) =>
            markBuildEnded({
              tx: tx as unknown as Db,
              caseId: row.id,
              toStatus: "build_failed",
              actor: { type: "system" },
              reason: `watchdog: stuck in building > ${STUCK_THRESHOLD_MINUTES}m`,
            }),
          ),
        );
        await step.sendEvent(`emit-failed-${row.id}`, {
          name: "case/build.failed",
          data: {
            caseId: row.id,
            reason: `watchdog: stuck in building > ${STUCK_THRESHOLD_MINUTES}m`,
            requestedBy: "system",
          },
        });
        killed += 1;
      } catch (err) {
        // CONFLICT means the case meanwhile transitioned out of
        // `building` (e.g. the parent finished while we were sweeping).
        // That's a valid race and not a watchdog failure — log + skip.
        console.warn("[case-build-watchdog] skipped", {
          caseId: row.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { swept: stuck.length, killed };
  },
);
