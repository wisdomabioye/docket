"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";

/**
 * Per-row Suspend control. Two-step flow:
 *   1. Click "Suspend" → reveals a textarea (reason required, 1-500 chars).
 *   2. Click "Confirm" → fires the mutation; closes the panel.
 *
 * Reason is mandatory at the server (Zod `min(1)`). UI mirrors that
 * with a disabled Confirm button when the textarea is empty.
 */
export function SuspendButton(props: {
  userId: string;
}): React.ReactElement {
  const router = useRouter();
  const suspend = trpc.admin.suspendAttorney.useMutation();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setOpen(false);
    setReason("");
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--ink-muted)] px-3 py-1.5 text-xs"
      >
        Suspend
      </button>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 500))}
        placeholder="Reason (required)"
        rows={2}
        aria-label="Suspension reason"
        className="w-48 rounded-md border border-[var(--ink-muted)] px-2 py-1 text-xs"
        disabled={suspend.isPending || isPending}
      />
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={
            suspend.isPending ||
            isPending ||
            reason.trim().length === 0
          }
          onClick={() => {
            setError(null);
            suspend.mutate(
              { userId: props.userId, reason: reason.trim() },
              {
                onSuccess: () => {
                  close();
                  startTransition(() => router.refresh());
                },
                onError: (err) => setError(err.message),
              },
            );
          }}
          className="rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {suspend.isPending ? "…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={suspend.isPending}
          className="px-3 py-1 text-[11px] text-[var(--ink-muted)] underline"
        >
          Cancel
        </button>
        {error ? (
          <p
            role="alert"
            className="max-w-[12rem] text-[10px] text-[var(--danger,var(--ink-soft))]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
