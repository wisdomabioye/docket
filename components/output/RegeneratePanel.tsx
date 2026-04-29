"use client";

import { useId, useState } from "react";
import type { ReactElement } from "react";
import { trpc } from "@/lib/trpc/react";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Right-rail regenerate panel. Optional guidance textarea (max 5000
 * chars to match the server-side Zod cap), then a button that fires
 * `output.regenerate`.
 *
 * Edge cases the panel handles:
 *   - Unsaved edits → confirm dialog (the host passes `isDirty`).
 *   - `recommendation_letter_template` → server throws on this path
 *     (open_issues #20). UI hides the button entirely for that type so
 *     the attorney isn't tempted into a guaranteed-failed click.
 *   - Rate limit → server returns TOO_MANY_REQUESTS; we surface the
 *     message verbatim (it carries the per-cap copy).
 *   - Auto-unapprove happens server-side; the parent invalidates
 *     `output.get` on success so the right-rail status updates.
 */

export type RegeneratePanelProps = {
  outputId: string;
  outputType: OutputType;
  isDirty: boolean;
  /** Called after the regenerate event is enqueued so the host can
   *  invalidate `output.get` + `output.list` and refetch. The Inngest
   *  function may take ~30s to write the new version; the UI should
   *  poll `output.list` for the version bump. */
  onEventEnqueued?: () => void;
};

const MAX_GUIDANCE = 5000;

export function RegeneratePanel(props: RegeneratePanelProps): ReactElement | null {
  const inputId = useId();
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const regenerateMutation = trpc.output.regenerate.useMutation({
    onSuccess: () => {
      setGuidance("");
      setError(null);
      props.onEventEnqueued?.();
    },
    onError: (err) => setError(err.message),
  });

  // Recommendation letters can't be regenerated through this path
  // (open_issues #20). Hide the entire panel rather than ship a button
  // that always fails.
  if (props.outputType === "recommendation_letter_template") {
    return (
      <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
        Regenerate isn&rsquo;t available for recommendation letters yet.
      </p>
    );
  }

  function handleClick(): void {
    if (regenerateMutation.isPending) return;
    if (
      props.isDirty &&
      !window.confirm(
        "You have unsaved edits. Regenerating will overwrite them. Continue?",
      )
    ) {
      return;
    }
    setError(null);
    regenerateMutation.mutate({
      outputId: props.outputId,
      ...(guidance.trim().length > 0 ? { guidance: guidance.trim() } : {}),
    });
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className="block text-[10px] uppercase tracking-wider"
        style={{ color: "var(--ink-muted)", fontWeight: 500 }}
      >
        Guidance (optional)
      </label>
      <textarea
        id={inputId}
        value={guidance}
        onChange={(e) => setGuidance(e.target.value.slice(0, MAX_GUIDANCE))}
        placeholder="What should the regenerate focus on?"
        rows={3}
        className="w-full rounded-sm border px-2 py-1 text-xs outline-none focus:ring-1"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          color: "var(--ink)",
        }}
        disabled={regenerateMutation.isPending}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={regenerateMutation.isPending}
        className="w-full rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        style={{
          borderColor: "var(--border-strong)",
          background: "var(--surface)",
          color: "var(--ink)",
        }}
      >
        {regenerateMutation.isPending ? "Queuing…" : "Regenerate"}
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
      <p
        className="text-[10px] leading-snug"
        style={{ color: "var(--ink-muted)" }}
      >
        A new version is drafted in the background and replaces the current
        approved status (you&rsquo;ll need to re-approve).
      </p>
    </div>
  );
}
