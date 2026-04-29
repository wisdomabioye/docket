"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import { trpc } from "@/lib/trpc/react";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Right-rail version list for an output. Each row shows version number,
 * author, approval state, time. A "Restore" button on non-current rows
 * triggers `output.restoreVersion` (copies the prior content into a new
 * `is_current` row — preserves history).
 *
 * The current version's row has no Restore button (you can't restore
 * what's already current).
 */

export type VersionHistoryProps = {
  caseId: string;
  outputType: OutputType;
  /** When the output is `recommendation_letter_template`, the parent
   *  passes the recommender's `subgroup_key`. Single-instance types
   *  pass `null`. */
  subgroupKey: string | null;
  /** Used to mark the "current" badge in the list — passed in (rather
   *  than read from the row's `isCurrent` flag) so the parent can
   *  highlight a different version when the user is previewing prior
   *  content via the version selector. */
  currentVersionId: string;
  /** Called after a successful restore so the host can refetch
   *  `output.get` (the new current version's id changes). */
  onRestoreSuccess?: (newOutputId: string) => void;
};

export function VersionHistory(props: VersionHistoryProps): ReactElement {
  const utils = trpc.useUtils();
  const versionsQuery = trpc.output.listVersions.useQuery({
    caseId: props.caseId,
    outputType: props.outputType,
    ...(props.subgroupKey !== null ? { subgroupKey: props.subgroupKey } : {}),
  });

  const restoreMutation = trpc.output.restoreVersion.useMutation({
    onSuccess: async (data) => {
      await utils.output.list.invalidate();
      await utils.output.listVersions.invalidate();
      props.onRestoreSuccess?.(data.outputId);
    },
  });

  // Per-version "restoring" state — disable that row's button while
  // its mutation is in flight; other rows stay clickable.
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (versionsQuery.isLoading) {
    return (
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        Loading versions…
      </p>
    );
  }
  if (versionsQuery.isError) {
    return (
      <p
        className="text-xs"
        style={{ color: "var(--danger, var(--ink-soft))" }}
      >
        Couldn&rsquo;t load version history.
      </p>
    );
  }

  const versions = versionsQuery.data ?? [];
  if (versions.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        No versions yet.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {versions.map((v) => {
        const isCurrent = v.id === props.currentVersionId;
        const isRestoring = restoreMutation.isPending && pendingId === v.id;
        return (
          <li
            key={v.id}
            className="flex items-center justify-between rounded-sm px-2 py-1.5 text-xs"
            style={{
              background: isCurrent ? "var(--surface-sunken)" : "transparent",
            }}
          >
            <div className="flex items-baseline gap-2">
              <span
                className="font-medium"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--ink)",
                }}
              >
                v{v.outputVersion}
              </span>
              {isCurrent ? (
                <span style={{ color: "var(--ink-muted)" }}>· current</span>
              ) : null}
              <span
                style={{
                  color: "var(--ink-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                · {v.author}
                {v.attorneyApproved ? " · approved" : ""}
              </span>
            </div>
            {!isCurrent ? (
              <button
                type="button"
                disabled={restoreMutation.isPending}
                onClick={() => {
                  setPendingId(v.id);
                  restoreMutation.mutate({ fromVersionId: v.id });
                }}
                className="text-[11px] underline disabled:opacity-50"
                style={{ color: "var(--ink-soft)" }}
              >
                {isRestoring ? "Restoring…" : "Restore"}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
