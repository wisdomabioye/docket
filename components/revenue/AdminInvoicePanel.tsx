"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { formatCents } from "@/lib/utils";

/**
 * Stage 10 admin invoice control. Lets an admin (a) preview the
 * eligible cases for an (attorney, year, month) tuple — i.e. cases
 * filed in that calendar month with a non-zero fee and revenue_status
 * still in `pending` / `failed` — and (b) trigger Stripe invoice
 * generation. The mutation calls `revenue.adminGenerateInvoice`,
 * which is wrapped in `withAudit` server-side, so each click leaves
 * an audit row even if the Stripe call fails.
 *
 * Defaults to the previous calendar month (UTC) — Docket invoices on
 * the 1st for the prior month, so that's what an admin landing on
 * this page on the 1st-3rd of a month wants to see.
 *
 * The preview is a separate query (`eligibleCasesForPeriod`); we
 * don't auto-fetch on mount to avoid a slow page load — admin clicks
 * "Preview" then "Generate". `Generate` is gated on at least one
 * eligible case.
 */
export type AttorneyOption = {
  userId: string;
  label: string;
};

export type AdminInvoicePanelProps = {
  attorneys: ReadonlyArray<AttorneyOption>;
};

export function AdminInvoicePanel(
  props: AdminInvoicePanelProps,
): React.ReactElement {
  const router = useRouter();
  const defaults = useMemo(() => previousMonthUtc(), []);
  const [attorneyUserId, setAttorneyUserId] = useState<string>(
    props.attorneys[0]?.userId ?? "",
  );
  const [periodYear, setPeriodYear] = useState<number>(defaults.year);
  const [periodMonth, setPeriodMonth] = useState<number>(defaults.month);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Snapshot of the form state the most recent Preview was issued for.
  // Lets us detect when the rendered preview is stale (admin changed
  // attorney/period after previewing) and gate Generate accordingly —
  // the mutation itself uses live form state and the server re-computes
  // the eligible set, so a mis-click here would still produce a
  // CORRECT invoice for the new selection, but the preview would have
  // misled the admin about what they're billing. This avoids that.
  const [previewedFor, setPreviewedFor] = useState<{
    attorneyUserId: string;
    periodYear: number;
    periodMonth: number;
  } | null>(null);

  const previewQuery = trpc.revenue.eligibleCasesForPeriod.useQuery(
    { attorneyUserId, periodYear, periodMonth },
    { enabled: false },
  );
  const generateMutation = trpc.revenue.adminGenerateInvoice.useMutation({
    onSuccess: (result) => {
      setError(null);
      setSuccess(
        `Invoice ${result.invoiceId.slice(0, 8)} generated · ${formatCents(result.totalCents)}`,
      );
      setPreviewedFor(null);
      router.refresh();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const previewIsFresh =
    previewedFor !== null &&
    previewedFor.attorneyUserId === attorneyUserId &&
    previewedFor.periodYear === periodYear &&
    previewedFor.periodMonth === periodMonth;
  const previewItems = previewIsFresh ? (previewQuery.data?.items ?? []) : [];
  const previewTotal = previewIsFresh ? (previewQuery.data?.totalDocketCents ?? 0) : 0;
  const canGenerate =
    previewIsFresh && previewItems.length > 0 && !generateMutation.isPending;

  function handlePreview(): void {
    setError(null);
    setSuccess(null);
    setPreviewedFor({ attorneyUserId, periodYear, periodMonth });
    void previewQuery.refetch();
  }
  function handleGenerate(): void {
    if (!attorneyUserId) {
      setError("Select an attorney first.");
      return;
    }
    setError(null);
    setSuccess(null);
    generateMutation.mutate({ attorneyUserId, periodYear, periodMonth });
  }

  if (props.attorneys.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        No attorneys with filed cases yet — invoice generation is unavailable.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px_auto]">
        <label className="block text-xs">
          <span
            className="block text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            Attorney
          </span>
          <select
            value={attorneyUserId}
            onChange={(e) => setAttorneyUserId(e.target.value)}
            className="mt-1 w-full rounded-sm border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            {props.attorneys.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span
            className="block text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            Year
          </span>
          <input
            type="number"
            min={2024}
            max={2100}
            value={periodYear}
            onChange={(e) => setPeriodYear(parseIntOr(e.target.value, periodYear))}
            className="mt-1 w-full rounded-sm border px-2 py-1.5 text-sm mono"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          />
        </label>

        <label className="block text-xs">
          <span
            className="block text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            Month
          </span>
          <input
            type="number"
            min={1}
            max={12}
            value={periodMonth}
            onChange={(e) => setPeriodMonth(parseIntOr(e.target.value, periodMonth))}
            className="mt-1 w-full rounded-sm border px-2 py-1.5 text-sm mono"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          />
        </label>

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewQuery.isFetching || !attorneyUserId}
            className="rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
          >
            {previewQuery.isFetching ? "Loading…" : "Preview"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded-sm border px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ borderColor: "var(--ink)", background: "var(--ink)" }}
          >
            {generateMutation.isPending ? "Generating…" : "Generate invoice"}
          </button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="text-xs"
          style={{ color: "var(--danger, #b1330e)" }}
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="text-xs"
          style={{ color: "var(--success, #1f6b3d)" }}
        >
          {success}
        </p>
      ) : null}

      {previewIsFresh && previewQuery.data ? (
        previewItems.length === 0 ? (
          <p
            className="rounded-sm border border-dashed p-3 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
          >
            No eligible cases for this period. Cases must be filed within the
            month and have a non-waived, non-invoiced fee.
          </p>
        ) : (
          <div
            className="rounded-sm border"
            style={{ borderColor: "var(--border)" }}
          >
            <header
              className="flex items-baseline justify-between border-b px-3 py-2"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                {previewItems.length} eligible {previewItems.length === 1 ? "case" : "cases"} · Docket share
              </span>
              <span className="mono text-sm">{formatCents(previewTotal)}</span>
            </header>
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {previewItems.map((c) => (
                <li
                  key={c.id}
                  className="flex items-baseline justify-between px-3 py-2 text-xs"
                >
                  <span className="mono">{c.visaType}</span>
                  <span style={{ color: "var(--ink-soft)" }}>
                    {c.beneficiaryFullName ?? "—"}
                  </span>
                  <span className="mono">{formatCents(BigInt(c.docketShareCents))}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}

function previousMonthUtc(): { year: number; month: number } {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function parseIntOr(s: string, fallback: number): number {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}
