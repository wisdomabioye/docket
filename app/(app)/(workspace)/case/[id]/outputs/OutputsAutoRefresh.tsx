"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";

/**
 * Polls the case + outputs list while the build is in flight and
 * triggers a `router.refresh()` whenever new drafts land or the
 * case status leaves `building`. Renders nothing — the SSR grid on
 * `outputs/page.tsx` is the source of truth for layout; this just
 * keeps it fresh without the attorney hitting refresh.
 *
 * Polling stops as soon as status flips out of `building` (build
 * succeeded, failed, or got archived) so we don't burn a refetch
 * every 5s on terminal cases. The component still mounts on those
 * pages — re-mounts when the user navigates back — so a future
 * status change picks polling back up naturally.
 *
 * The two-query setup is deliberate: `case.get` flips status, and
 * `output.list` length flips before status does (Computer commits
 * each draft individually). Watching both means a new card surfaces
 * the moment its row lands, not just at the end-of-build.
 */
export function OutputsAutoRefresh(props: {
  caseId: string;
  initialStatus: string;
  initialOutputCount: number;
}): null {
  const router = useRouter();
  const polling = props.initialStatus === "building";
  const refetchInterval = polling ? 5000 : false;

  const caseQuery = trpc.case.get.useQuery(
    { caseId: props.caseId },
    { refetchInterval, staleTime: 0 },
  );
  const listQuery = trpc.output.list.useQuery(
    { caseId: props.caseId },
    { refetchInterval, staleTime: 0 },
  );

  const lastStatusRef = useRef(props.initialStatus);
  const lastCountRef = useRef(props.initialOutputCount);

  useEffect(() => {
    const liveStatus = caseQuery.data?.status;
    const liveCount = listQuery.data?.length;
    let shouldRefresh = false;
    if (liveStatus !== undefined && liveStatus !== lastStatusRef.current) {
      lastStatusRef.current = liveStatus;
      shouldRefresh = true;
    }
    if (liveCount !== undefined && liveCount !== lastCountRef.current) {
      lastCountRef.current = liveCount;
      shouldRefresh = true;
    }
    if (shouldRefresh) router.refresh();
  }, [caseQuery.data?.status, listQuery.data?.length, router]);

  return null;
}
