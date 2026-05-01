"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import { trpc } from "@/lib/trpc/react";

/**
 * Right-rail approval + per-output PDF download. The approval state
 * gates the editor (you must un-approve to edit) AND the package
 * compile (only approved outputs go in). Both effects are server-side;
 * the UI just toggles the boolean.
 *
 * Stage 11 W4: Approve auto-flushes any pending draft as a new
 * version BEFORE setting `attorney_approved=true` — the server-side
 * `approveOutput` service handles this atomically (W4.3). The button
 * is therefore always enabled when not approved; no `saveBeforeApprove`
 * race-prevention prop. When a flush happens, the host's
 * `onApprovedIdChange` callback fires with the NEW version's id so
 * the URL can re-route.
 *
 * Download PDF: fires `output.downloadPdf` mutation, which renders +
 * uploads the PDF and returns a 10-min signed URL. We open it in a
 * new tab so the user doesn't lose the editor session.
 */

export type ApprovalActionsProps = {
  outputId: string;
  attorneyApproved: boolean;
  /** Notify the host when approval flips OR when the approved id
   *  changes (i.e., a pending draft was flushed into a new version).
   *  `newOutputId` differs from `outputId` only on the draft-flush
   *  path. */
  onApprovalChange?: (newOutputId: string) => void;
};

export function ApprovalActions(props: ApprovalActionsProps): ReactElement {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const approveMutation = trpc.output.approve.useMutation({
    onSuccess: async (data) => {
      setError(null);
      await Promise.all([
        utils.output.get.invalidate({ outputId: props.outputId }),
        utils.output.list.invalidate(),
        // Listing versions changes when approve flushes a draft (new
        // v(N+1) row appears). Invalidate so the right-rail history
        // reflects it without a manual refresh.
        utils.output.listVersions.invalidate(),
        // Approval gates the package preflight ("approved outputs"
        // and "recommender letters" rows). Without this invalidation
        // the Package page sticks on stale gate state until refresh.
        utils.case.preflight.invalidate(),
      ]);
      // `data?.approvedOutputId` differs from `props.outputId` only
      // when the server flushed a pending draft into a new version.
      // Falling back to `props.outputId` keeps the callback contract
      // stable for the no-flush path.
      props.onApprovalChange?.(data?.approvedOutputId ?? props.outputId);
    },
    onError: (err) => setError(err.message),
  });

  const unapproveMutation = trpc.output.unapprove.useMutation({
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        utils.output.get.invalidate({ outputId: props.outputId }),
        utils.output.list.invalidate(),
        utils.case.preflight.invalidate(),
      ]);
      // Un-approve never changes the id — same row, just a flag flip.
      props.onApprovalChange?.(props.outputId);
    },
    onError: (err) => setError(err.message),
  });

  const downloadMutation = trpc.output.downloadPdf.useMutation({
    onSuccess: ({ url }) => {
      setError(null);
      // Open the signed URL in a new tab. We intentionally don't pre-
      // generate (the URL is 10-min lived; pre-generation would burn
      // signed-URL TTL on a button the user might never click).
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => setError(err.message),
  });

  const isPending =
    approveMutation.isPending ||
    unapproveMutation.isPending ||
    downloadMutation.isPending;

  return (
    <div className="space-y-2">
      {props.attorneyApproved ? (
        <button
          type="button"
          onClick={() => unapproveMutation.mutate({ outputId: props.outputId })}
          disabled={isPending}
          className="w-full rounded-sm px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{
            background: "var(--surface-sunken)",
            color: "var(--ink)",
          }}
        >
          {unapproveMutation.isPending ? "Working…" : "Un-approve"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => approveMutation.mutate({ outputId: props.outputId })}
          disabled={isPending}
          className="w-full rounded-sm px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          style={{
            background: "var(--accent, var(--ink))",
          }}
          // No `saveBeforeApprove` disable: the server-side
          // `approveOutput` (W4.3) flushes any pending draft into a
          // new version BEFORE setting the approval flag, so an
          // approve always locks in what the user sees on screen.
          title="Lock in the current version. Any pending draft is committed first."
        >
          {approveMutation.isPending ? "Working…" : "Approve"}
        </button>
      )}

      <button
        type="button"
        onClick={() => downloadMutation.mutate({ outputId: props.outputId })}
        disabled={isPending}
        className="w-full rounded-sm border px-3 py-1.5 text-xs disabled:opacity-50"
        style={{
          borderColor: "var(--border)",
          color: "var(--ink-soft)",
        }}
      >
        {downloadMutation.isPending ? "Preparing PDF…" : "Download PDF"}
      </button>

      {error ? (
        <p
          role="alert"
          className="text-[11px]"
          style={{ color: "var(--danger, var(--ink-soft))" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
