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
 * Download PDF: fires `output.downloadPdf` mutation, which renders +
 * uploads the PDF and returns a 10-min signed URL. We open it in a
 * new tab so the user doesn't lose the editor session.
 */

export type ApprovalActionsProps = {
  outputId: string;
  attorneyApproved: boolean;
  /** When the editor has unsaved edits, approving would lock-in stale
   *  content. Disable the Approve button until the host saves first. */
  saveBeforeApprove: boolean;
  onApprovalChange?: () => void;
};

export function ApprovalActions(props: ApprovalActionsProps): ReactElement {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const approveMutation = trpc.output.approve.useMutation({
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        utils.output.get.invalidate({ outputId: props.outputId }),
        utils.output.list.invalidate(),
      ]);
      props.onApprovalChange?.();
    },
    onError: (err) => setError(err.message),
  });

  const unapproveMutation = trpc.output.unapprove.useMutation({
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        utils.output.get.invalidate({ outputId: props.outputId }),
        utils.output.list.invalidate(),
      ]);
      props.onApprovalChange?.();
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
          disabled={isPending || props.saveBeforeApprove}
          className="w-full rounded-sm px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          style={{
            background: "var(--accent, var(--ink))",
          }}
          title={
            props.saveBeforeApprove
              ? "Save your edits first. Approving with unsaved changes would lock in the stale version."
              : undefined
          }
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
