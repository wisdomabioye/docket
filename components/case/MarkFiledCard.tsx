"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { trpc } from "@/lib/trpc/react";
import type { CaseStatus } from "@/lib/case-status";

/**
 * ADR-006 Step 6 — "Mark as filed" card for the package page.
 *
 * Visible only when `caseStatus === "delivered"`. Once the attorney
 * marks the case filed:
 *   - server flips `cases.status` to `filed` and stamps `filedAt`
 *   - the card disappears (the page re-renders with `filed` status)
 *
 * Receipt number is optional — USCIS receipts are issued post-filing,
 * so the attorney may not have one in hand yet. Strict idempotency
 * per ADR-006: once a case is filed, the receipt number is locked.
 * Typos require an admin to call `admin.case.unmarkFiled` first.
 */
export function MarkFiledCard(props: {
  caseId: string;
  /** Card shows only when status is `delivered`. Anywhere else returns
   *  `null` so the package page doesn't have to gate the render. */
  caseStatus: CaseStatus;
}): ReactElement | null {
  const router = useRouter();
  const [receiptNumber, setReceiptNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.case.markFiled.useMutation({
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  if (props.caseStatus !== "delivered") return null;

  function onSubmit(e: { preventDefault: () => void }): void {
    e.preventDefault();
    setError(null);
    const trimmed = receiptNumber.trim();
    mutation.mutate({
      caseId: props.caseId,
      ...(trimmed.length > 0 ? { receiptNumber: trimmed } : {}),
    });
  }

  return (
    <Card title="Mark as filed" flush>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-4">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Once filed with USCIS, paste the receipt number below to link the
          case to its real handler. The receipt is optional now — you can
          leave it blank and add it later by asking an admin to reverse and
          re-mark.
        </p>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="receiptNumber"
            className="text-xs font-medium"
            style={{ color: "var(--ink-muted)" }}
          >
            USCIS receipt number (optional)
          </label>
          <input
            id="receiptNumber"
            type="text"
            value={receiptNumber}
            onChange={(e) => setReceiptNumber(e.target.value)}
            placeholder="e.g. MSC2200000001"
            maxLength={50}
            className="rounded-sm border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border-strong)" }}
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-sm border px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--ink)",
            }}
          >
            {mutation.isPending ? "Marking…" : "Mark as filed"}
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
      </form>
    </Card>
  );
}
