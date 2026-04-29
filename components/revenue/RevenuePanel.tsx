"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/react";
import { useRouter } from "next/navigation";
import { computeRevenueSplit } from "@/server/services/stripe/split";

/**
 * Stage 10 per-case revenue panel. Renders fee + computed split with
 * an inline editable USD-cents input. Disabled when the case is
 * currently `invoiced` or `paid` (mutations would CONFLICT server-
 * side; UI mirrors the rule so the attorney isn't tempted).
 *
 * Save flow: user enters dollars (UI displays + parses cents);
 * `revenue.logCaseFee` mutates; on success the page refresh picks up
 * the new split.
 *
 * `0` is allowed (forces `waived` / pro bono); the UI shows a small
 * note when the saved fee is 0 so the attorney sees the case is
 * tracked but not billed.
 */

export type RevenuePanelProps = {
  caseId: string;
  /** Current revenue state from the server. Re-rendered after a save
   *  via `router.refresh()`. */
  initial: {
    feeCents: number;
    docketShareCents: number;
    attorneyShareCents: number;
    revenueStatus:
      | "pending"
      | "invoiced"
      | "paid"
      | "waived"
      | "failed";
  };
};

export function RevenuePanel(props: RevenuePanelProps): React.ReactElement {
  const router = useRouter();
  const [dollars, setDollars] = useState<string>(
    centsToDollarString(props.initial.feeCents),
  );
  const [error, setError] = useState<string | null>(null);

  const logFeeMutation = trpc.revenue.logCaseFee.useMutation({
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  const locked =
    props.initial.revenueStatus === "invoiced" ||
    props.initial.revenueStatus === "paid";
  const parsedCents = dollarsToCents(dollars);
  const previewSplit =
    parsedCents !== null ? computeRevenueSplit(parsedCents) : null;
  const dirty = parsedCents !== null && parsedCents !== props.initial.feeCents;

  function handleSave(): void {
    if (parsedCents === null) {
      setError("Enter a valid dollar amount.");
      return;
    }
    setError(null);
    logFeeMutation.mutate({
      caseId: props.caseId,
      feeCents: parsedCents,
    });
  }

  return (
    <section
      aria-label="Revenue"
      className="rounded-md border p-4"
      style={{
        borderColor: "var(--border)",
        background: "var(--surface)",
      }}
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h2
          className="text-xs uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          Revenue
        </h2>
        <span
          className="rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-wider"
          style={{
            background:
              props.initial.revenueStatus === "paid"
                ? "var(--success-soft)"
                : props.initial.revenueStatus === "failed"
                  ? "var(--warning-soft)"
                  : "var(--surface-sunken)",
            color:
              props.initial.revenueStatus === "paid"
                ? "var(--success)"
                : "var(--ink-soft)",
          }}
        >
          {props.initial.revenueStatus}
        </span>
      </header>

      <div className="space-y-3">
        <label className="block text-sm">
          <span
            className="block text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            Case fee (USD)
          </span>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="font-mono text-sm"
              style={{ color: "var(--ink-muted)" }}
            >
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
              disabled={locked || logFeeMutation.isPending}
              className="w-32 rounded-sm border px-2 py-1 text-sm font-mono disabled:opacity-50"
              style={{
                borderColor: "var(--border)",
                background: locked ? "var(--surface-sunken)" : "var(--surface)",
              }}
              aria-label="Case fee in USD"
            />
            {dirty && !locked ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={logFeeMutation.isPending}
                className="rounded-sm border px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                style={{
                  borderColor: "var(--ink)",
                  background: "var(--ink)",
                }}
              >
                {logFeeMutation.isPending ? "Saving…" : "Save fee"}
              </button>
            ) : null}
          </div>
        </label>

        <dl className="space-y-1 text-xs" style={{ color: "var(--ink-soft)" }}>
          <SplitRow
            label="Attorney share (85%)"
            cents={
              previewSplit?.attorneyShareCents ??
              props.initial.attorneyShareCents
            }
          />
          <SplitRow
            label="Docket share (15%)"
            cents={
              previewSplit?.docketShareCents ??
              props.initial.docketShareCents
            }
          />
        </dl>

        {locked ? (
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Locked — fee was{" "}
            {props.initial.revenueStatus === "paid"
              ? "billed and paid"
              : "billed to client"}
            . Admin can adjust if needed.
          </p>
        ) : props.initial.revenueStatus === "waived" ? (
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Pro-bono — no invoice will be generated. Enter a non-zero fee to
            re-bill.
          </p>
        ) : null}

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
    </section>
  );
}

function SplitRow({
  label,
  cents,
}: {
  label: string;
  cents: number;
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between">
      <dt>{label}</dt>
      <dd className="font-mono">{centsToDollarString(cents)} USD</dd>
    </div>
  );
}

function centsToDollarString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Parse a dollar string (`"1,234.56"` or `"1234.56"`) to cents.
 *  Returns `null` for malformed input. Trims commas + leading `$`. */
function dollarsToCents(s: string): number | null {
  const cleaned = s.trim().replace(/^\$/, "").replace(/,/g, "");
  if (cleaned.length === 0) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}
