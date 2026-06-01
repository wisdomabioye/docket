"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { isInProgressStatus } from "@/lib/case-stage";
import type { CaseStatus } from "@/lib/case-status";
import { CaseNextAction } from "./CaseNextAction";

/**
 * The slim next-action bar shown under the stage rail on every case tab
 * (Stage 13). Client component: fetches `case.guidance` and renders the
 * `bar` variant of `CaseNextAction`.
 *
 * Doubles as the in-progress auto-refresh. While the case is mid-pipeline
 * (`extracting` / `building`) it polls every 5s; when the work finishes
 * (status leaves the in-progress set) it fires one `router.refresh()` so
 * the server-rendered page (header, content, the Overview card) updates
 * without the attorney hitting reload. Polling stops once out of the
 * in-progress set, so terminal/idle cases don't burn refetches.
 *
 * `initialStatus` seeds the poll decision so the very first render already
 * polls when needed (before the query resolves).
 */

export type CaseActionBarProps = {
  caseId: string;
  initialStatus: CaseStatus;
};

const POLL_MS = 5000;

export function CaseActionBar(props: CaseActionBarProps): React.ReactElement | null {
  const router = useRouter();
  const seedInProgress = isInProgressStatus(props.initialStatus);

  const query = trpc.case.guidance.useQuery(
    { caseId: props.caseId },
    {
      // Poll while mid-pipeline — seeded by `initialStatus` for the first
      // render, then driven by the LIVE result so a build started in this
      // session also starts polling. Stops (false) once work finishes.
      refetchInterval: (q) =>
        (q.state.data?.progress.indeterminate ?? seedInProgress)
          ? POLL_MS
          : false,
      staleTime: 0,
    },
  );

  // Keep the bar in sync with the server-rendered header buttons. The
  // server passes the CURRENT `status`; when an action changes it (e.g.
  // upload flips ready_to_build, completeIntake advances the case) the
  // RSC header re-renders with a new `initialStatus`, but this client
  // query wouldn't otherwise refetch — leaving the bar stale while the
  // buttons above update. Refetching on `initialStatus` change closes
  // that gap. (React-query dedupes against the mount fetch.)
  const { refetch } = query;
  useEffect(() => {
    void refetch();
  }, [props.initialStatus, refetch]);

  // Track the in-progress edge so we refresh the page exactly once when
  // the pipeline finishes (avoids a refresh loop).
  const wasInProgress = useRef(seedInProgress);
  const liveIndeterminate = query.data?.progress.indeterminate;
  useEffect(() => {
    if (liveIndeterminate === undefined) return;
    if (wasInProgress.current && !liveIndeterminate) {
      wasInProgress.current = false;
      router.refresh();
    } else if (!wasInProgress.current && liveIndeterminate) {
      // A new build/extraction started in this session — resume tracking.
      wasInProgress.current = true;
    }
  }, [liveIndeterminate, router]);

  if (!query.data) return null;
  return <CaseNextAction guidance={query.data} variant="bar" />;
}
