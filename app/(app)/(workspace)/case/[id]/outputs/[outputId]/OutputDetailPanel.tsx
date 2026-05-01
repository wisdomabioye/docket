"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui";
import {
  ApprovalActions,
  DisclaimerBanner,
  RegeneratePanel,
  TiptapEditor,
  VersionHistory,
  useTiptapState,
} from "@/components/output";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Client island that orchestrates the output detail page:
 *   - Tiptap editor (Read ↔ Edit toggle)
 *   - Save version → `output.update` mutation (commits a new version)
 *   - Auto-save (3s debounce) → `output.saveDraft` (in-place draft buffer)
 *   - Cancel → `output.clearDraft` + restore editor to baseline content
 *   - Approve / Un-approve / Download PDF → ApprovalActions
 *   - Regenerate (with optional guidance) → RegeneratePanel
 *   - Version history list with Restore action → VersionHistory
 *
 * Draft semantics (Stage 11 W3): the editor's pending changes are
 * persisted to `case_outputs.draft_content` on a 3s debounce. When the
 * page loads with `draftContent !== content`, the editor opens in Edit
 * mode pre-loaded with the draft, so a closed-tab + reopen recovers
 * the attorney's last keystrokes (no `localStorage` — that wouldn't
 * survive a Vercel cold-start across devices anyway).
 */

export type InitialOutput = {
  id: string;
  outputType: OutputType;
  outputVersion: number;
  subgroupKey: string | null;
  content: string;
  /** Pending draft, NULL if no in-progress edits since last commit. */
  draftContent: string | null;
  attorneyApproved: boolean;
  approvedAt: string | null;
  updatedAt: string;
};

/** Debounce for auto-save. 3s matches the spec for "perceived
 *  immediacy without burning network" — short enough that a tab close
 *  won't lose more than ~3s of edits, long enough to coalesce a typing
 *  burst into one round-trip. */
const AUTOSAVE_DEBOUNCE_MS = 3000;

export type OutputDetailPanelProps = {
  caseId: string;
  caseLabel: string;
  typeDisplayName: string;
  initialOutput: InitialOutput;
};

export function OutputDetailPanel(
  props: OutputDetailPanelProps,
): ReactElement {
  const utils = trpc.useUtils();
  const tiptap = useTiptapState();

  // Refresh `output.get` to pick up new versions after a successful
  // save / regenerate / restore. `staleTime: 0` so post-mutation
  // invalidations always trigger a refetch.
  const outputQuery = trpc.output.get.useQuery(
    { outputId: props.initialOutput.id },
    { staleTime: 0 },
  );
  const live = outputQuery.data ?? null;
  const liveContent = live?.content ?? props.initialOutput.content;
  // Prefer LIVE when the query has resolved — even when the live value
  // is explicitly `null` (e.g., a Save just committed and cleared the
  // draft on the server). A naive `live?.draftContent ?? initial`
  // would collapse `null` and `undefined` together and re-show the
  // initial draft after a commit, racing the next refetch.
  const liveDraft: string | null = live
    ? ((live.draftContent as string | null | undefined) ?? null)
    : props.initialOutput.draftContent;
  // True ONLY when the draft differs from the committed baseline.
  // A draft that equals content is logically clean — covers the case
  // where a prior session saved a draft, the user later restored a
  // version that happens to match, etc.
  const hasPendingDraft = liveDraft !== null && liveDraft !== liveContent;

  // Editor opens to the draft if one is pending (preserves the
  // attorney's last unsaved keystrokes across a tab close + reopen).
  // Otherwise the committed content is the baseline.
  const editorBaseline = hasPendingDraft && liveDraft !== null ? liveDraft : liveContent;
  const currentVersion = live?.outputVersion ?? props.initialOutput.outputVersion;
  const attorneyApproved =
    live?.attorneyApproved ?? props.initialOutput.attorneyApproved;
  const approvedAt =
    (live?.approvedAt instanceof Date
      ? live.approvedAt.toISOString()
      : (live?.approvedAt as string | null | undefined) ?? null) ??
    props.initialOutput.approvedAt;
  const updatedAtIso =
    (live?.updatedAt instanceof Date
      ? live.updatedAt.toISOString()
      : (live?.updatedAt as string | null | undefined) ?? null) ??
    props.initialOutput.updatedAt;

  // `useState(initializer)` runs once on mount — opens in Edit mode if
  // the loaded payload has a pending draft. Subsequent prop changes do
  // NOT re-derive (changing mode would be jarring mid-edit).
  const [mode, setMode] = useState<"read" | "edit">(() =>
    props.initialOutput.draftContent !== null &&
    props.initialOutput.draftContent !== props.initialOutput.content
      ? "edit"
      : "read",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(() =>
    // Lazy init — `new Date()` is impure and would otherwise be
    // re-constructed (and discarded) on every render.
    //
    // Caveat (logged as open_issues #30): on draft-recovery this stamps
    // "just now" regardless of when the server actually persisted the
    // draft. Fixing requires a `draft_updated_at` column.
    hasPendingDraft ? new Date() : null,
  );
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);

  // ── Auto-save plumbing ─────────────────────────────────────────────
  // Debounce timer + concurrency guard refs. Using refs (not state) so
  // a re-render doesn't reset the timer mid-flight. The chained
  // promise pattern matches `PackageAssemblyCard` — every save waits
  // on the prior save to settle, which prevents an out-of-order write
  // from clobbering a newer one.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());
  // What we last persisted server-side, so we can short-circuit
  // no-op writes BEFORE issuing the network call (the server's
  // idempotency check is belt-and-suspenders for two-tab racers).
  const lastSavedDraftRef = useRef<string | null>(
    props.initialOutput.draftContent,
  );
  // Track whether the tiptap editor was ever marked dirty THIS mount;
  // we use it to guard the "open with draft → seed isDirty=true" effect
  // from running every prop change.
  const seededDirtyRef = useRef(false);

  const saveDraftMutation = trpc.output.saveDraft.useMutation({
    onError: (err) => setAutoSaveError(err.message),
  });
  const clearDraftMutation = trpc.output.clearDraft.useMutation();

  // Seed `isDirty=true` once after the editor mounts, IF the page
  // loaded with a pending draft. Without this, Save would render
  // disabled even though the editor displays unsaved (recovered) text.
  useEffect(() => {
    if (seededDirtyRef.current) return;
    if (!tiptap.api) return;
    if (hasPendingDraft) {
      tiptap.setDirty(true);
    }
    seededDirtyRef.current = true;
  }, [tiptap.api, hasPendingDraft, tiptap]);

  function flushAutoSave(): void {
    if (!tiptap.api) return;
    const md = tiptap.api.getMarkdown();
    // No-op short-circuit (avoids a useless network round-trip when the
    // user happened to land back on the previously-saved text — rare,
    // but the equality check is free).
    if (md === lastSavedDraftRef.current) return;
    setAutoSaveError(null);
    inFlightRef.current = inFlightRef.current
      .catch(() => undefined)
      .then(async () => {
        // Re-snapshot at fire time: the user may have typed between
        // when the timer queued this mutation and when the prior
        // in-flight save resolved. We want the LATEST text, not the
        // text we captured 3s ago.
        const fresh = tiptap.api?.getMarkdown() ?? md;
        if (fresh === lastSavedDraftRef.current) return;
        try {
          await saveDraftMutation.mutateAsync({
            outputId: props.initialOutput.id,
            content: fresh,
          });
          lastSavedDraftRef.current = fresh;
          setAutoSavedAt(new Date());
        } catch {
          // Mutation hook's onError already surfaced the message; the
          // catch keeps the chain alive so the next user keystroke
          // isn't blocked by a poisoned promise.
        }
      });
  }

  function scheduleAutoSave(): void {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      flushAutoSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // Wrap setDirty so a dirty edit also kicks the autosave debounce.
  // Memoized only via stable identity from `useTiptapState` (setDirty
  // is the React useState setter, already stable).
  function handleDirtyChange(dirty: boolean): void {
    tiptap.setDirty(dirty);
    if (dirty) scheduleAutoSave();
  }

  // Cleanup on unmount: clear any pending timer so it doesn't fire
  // after the editor is gone. The in-flight promise is allowed to
  // settle (no point cancelling a save that's already on the wire).
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const updateMutation = trpc.output.update.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      // Reset the autosave bookkeeping — `saveOutputVersion` cleared
      // the server-side draft as part of committing the new version.
      lastSavedDraftRef.current = null;
      setAutoSavedAt(null);
      setAutoSaveError(null);
      await Promise.all([
        utils.output.get.invalidate({ outputId: props.initialOutput.id }),
        utils.output.list.invalidate(),
        utils.output.listVersions.invalidate(),
      ]);
      tiptap.setDirty(false);
      setMode("read");
    },
    onError: (err) => setSaveError(err.message),
  });

  function handleSave(): void {
    if (!tiptap.api) return;
    // Pre-empt any queued autosave: the explicit commit supersedes it.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const md = tiptap.api.getMarkdown();
    if (md.trim().length === 0) {
      setSaveError(
        "Content cannot be empty — use Regenerate to draft fresh prose.",
      );
      return;
    }
    setSaveError(null);
    // Serialize behind any in-flight autosave. Without this, an
    // autosave's `saveDraft` write can land AFTER the commit creates
    // v(N+1) — at which point the autosave's outputId is no longer
    // current and the server returns BAD_REQUEST, surfacing a confusing
    // "Cannot save draft on a non-current version" error to a user who
    // just successfully clicked Save.
    inFlightRef.current = inFlightRef.current
      .catch(() => undefined)
      .then(() => updateMutation.mutateAsync({
        outputId: props.initialOutput.id,
        content: md,
      }))
      .catch(() => {
        // updateMutation's onError already surfaced via setSaveError.
      });
  }

  function handleCancel(): void {
    if (tiptap.isDirty && !window.confirm("Discard your edits?")) return;
    // Pre-empt any queued autosave so it doesn't re-write the draft we
    // just asked the server to clear.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    tiptap.api?.setMarkdown(liveContent);
    setMode("read");
    setSaveError(null);
    setAutoSaveError(null);
    // Serialize behind any in-flight autosave: clearDraft must NOT race
    // a saveDraft, or the draft re-appears on next reload depending on
    // network arrival order.
    inFlightRef.current = inFlightRef.current
      .catch(() => undefined)
      .then(() =>
        clearDraftMutation.mutateAsync({ outputId: props.initialOutput.id }),
      )
      .then(() => {
        lastSavedDraftRef.current = null;
        setAutoSavedAt(null);
        return utils.output.get.invalidate({
          outputId: props.initialOutput.id,
        });
      })
      .catch(() => {
        // Best-effort. Failed clearDraft → draft resurfaces on next
        // reload (survivable; user can Cancel again or Save).
      });
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--cream)" }}>
      <header
        className="border-b px-6 pt-4 pb-3"
        style={{ borderColor: "var(--border)", background: "var(--cream)" }}
      >
        <p
          className="text-[11px] uppercase tracking-[0.06em]"
          style={{ color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}
        >
          {props.caseLabel}
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <h1
            className="text-xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {props.typeDisplayName}{" "}
            <span
              className="text-sm font-normal"
              style={{ color: "var(--ink-muted)" }}
            >
              · v{currentVersion}
            </span>
          </h1>
          <Link
            href={APP_ROUTES.caseOutputs(props.caseId)}
            className="text-xs underline"
            style={{ color: "var(--ink-soft)" }}
          >
            ← All outputs
          </Link>
        </div>
      </header>

      <div
        className="grid"
        style={{
          // Editor is `1fr` (the wide column); right rail is the narrow
          // 260-320px sidebar. Earlier inversion put the editor in the
          // narrow track which made the prose column unreadable.
          gridTemplateColumns: "1fr minmax(260px, 320px)",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Center column */}
        <section className="flex min-w-0 flex-col" style={{ gridColumn: "1 / 2" }}>
          <div
            className="flex h-9 items-center gap-1 border-b px-3 text-xs"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
            }}
          >
            <button
              type="button"
              onClick={() => setMode("read")}
              className="rounded-sm px-2 py-1"
              style={{
                background:
                  mode === "read" ? "var(--ink)" : "transparent",
                color: mode === "read" ? "var(--white)" : "var(--ink-soft)",
              }}
            >
              Read
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              disabled={attorneyApproved}
              className="rounded-sm px-2 py-1 disabled:opacity-50"
              style={{
                background:
                  mode === "edit" ? "var(--ink)" : "transparent",
                color: mode === "edit" ? "var(--white)" : "var(--ink-soft)",
              }}
              title={
                attorneyApproved
                  ? "Un-approve before editing."
                  : "Switch to edit mode."
              }
            >
              Edit
            </button>
            <span className="flex-1" />
            {mode === "edit" ? (
              <>
                {saveError ? (
                  <span
                    role="alert"
                    className="text-[11px]"
                    style={{ color: "var(--error, var(--ink-soft))" }}
                  >
                    {saveError}
                  </span>
                ) : null}
                <AutoSaveStatus
                  pending={saveDraftMutation.isPending}
                  errorMessage={autoSaveError}
                  savedAt={autoSavedAt}
                />
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={updateMutation.isPending}
                  className="px-2 py-1 text-[11px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={updateMutation.isPending || !tiptap.isDirty}
                  className="rounded-sm px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--accent, var(--ink))" }}
                  // "Save version" makes the commit-vs-draft distinction
                  // explicit: the autosave handles in-progress edits;
                  // this button creates a new versioned commit.
                  title="Commit current draft as a new version"
                >
                  {updateMutation.isPending ? "Saving…" : "Save version"}
                </button>
              </>
            ) : (
              <span
                className="text-[11px]"
                style={{
                  color: "var(--ink-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {formatTimestamp(updatedAtIso)}
              </span>
            )}
          </div>

          <DisclaimerBanner />

          <div className="flex-1 overflow-y-auto">
            {/* Doc card. Width + chrome mirror `Docket-Meridian-UI/hifi/output-detail.html`
             *  `.doc-page` (max-w 640px, white bg, soft border + shadow).
             *  Padding is intentionally absent here — `.ProseMirror`
             *  (in globals.css) carries the 50px / 60px page padding so
             *  the toolbar (TiptapEditor's first sibling) sits flush at
             *  the top of the card, no nested chrome. */}
            <div
              className="mx-auto my-4 max-w-[640px] overflow-hidden rounded-sm border bg-white"
              style={{
                borderColor: "var(--border)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <TiptapEditor
                initialMarkdown={editorBaseline}
                readOnly={mode === "read"}
                onDirtyChange={handleDirtyChange}
                onReady={tiptap.setApi}
              />
            </div>
          </div>
        </section>

        {/* Right rail */}
        <aside
          className="space-y-5 border-l p-4"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface)",
            gridColumn: "2 / 3",
          }}
        >
          <section className="space-y-2">
            <RailSectionHeader>Status</RailSectionHeader>
            <RailKv label="Version">
              <span style={{ fontFamily: "var(--font-mono)" }}>
                v{currentVersion}
              </span>
            </RailKv>
            <RailKv label="Status">
              <Badge variant={attorneyApproved ? "success" : "neutral"}>
                {attorneyApproved ? "Approved" : "Draft"}
              </Badge>
            </RailKv>
            {attorneyApproved && approvedAt ? (
              <RailKv label="Approved">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                  }}
                >
                  {formatTimestamp(approvedAt)}
                </span>
              </RailKv>
            ) : null}
          </section>

          <section className="space-y-2">
            <RailSectionHeader>Actions</RailSectionHeader>
            <ApprovalActions
              outputId={props.initialOutput.id}
              attorneyApproved={attorneyApproved}
              saveBeforeApprove={tiptap.isDirty}
            />
          </section>

          <section className="space-y-2">
            <RailSectionHeader>Regenerate</RailSectionHeader>
            <RegeneratePanel
              outputId={props.initialOutput.id}
              outputType={props.initialOutput.outputType}
              isDirty={tiptap.isDirty}
              onEventEnqueued={() => {
                // The Inngest function may take ~30s; the user
                // perceives "queued" via this immediate refresh + the
                // version-bump on next list refetch.
                void utils.output.get.invalidate({
                  outputId: props.initialOutput.id,
                });
                void utils.output.list.invalidate();
              }}
            />
          </section>

          <section className="space-y-2">
            <RailSectionHeader>Versions</RailSectionHeader>
            <VersionHistory
              caseId={props.caseId}
              outputType={props.initialOutput.outputType}
              subgroupKey={props.initialOutput.subgroupKey}
              currentVersionId={live?.id ?? props.initialOutput.id}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

function RailSectionHeader({
  children,
}: {
  children: ReactElement | string;
}): ReactElement {
  return (
    <h3
      className="text-[10px] uppercase tracking-wider"
      style={{ color: "var(--ink-muted)", fontWeight: 500 }}
    >
      {children}
    </h3>
  );
}

function RailKv({
  label,
  children,
}: {
  label: string;
  children: ReactElement | string;
}): ReactElement {
  return (
    <div
      className="flex items-center justify-between border-b py-1.5 text-xs"
      style={{ borderColor: "var(--border)" }}
    >
      <span style={{ color: "var(--ink-muted)" }}>{label}</span>
      <span style={{ color: "var(--ink)", fontWeight: 500 }}>{children}</span>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Auto-save status pill rendered in the editor toolbar.
 *
 * Three states (in priority order):
 *   - Pending mutation → "Saving…"
 *   - Last attempt errored → "Auto-save failed: <message>" (alert role)
 *   - Last attempt succeeded → "Auto-saved · Xs ago" (relative)
 *   - None of the above → renders nothing (clean toolbar pre-edit)
 *
 * Uses a self-ticking 5s interval to refresh the relative timestamp
 * without depending on parent re-renders. Cleans up on unmount.
 */
function AutoSaveStatus(props: {
  pending: boolean;
  errorMessage: string | null;
  savedAt: Date | null;
}): ReactElement | null {
  // 5s tick — coarse enough that the per-keystroke render volume in
  // the parent doesn't matter, fine enough that "10s ago" updates
  // visibly within the next bucket. The lazy initializer keeps the
  // initial render pure (Date.now is impure on the render path).
  const [, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (props.savedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [props.savedAt]);

  if (props.pending) {
    return (
      <span
        className="text-[11px]"
        style={{
          color: "var(--ink-muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        Saving…
      </span>
    );
  }
  if (props.errorMessage) {
    return (
      <span
        role="alert"
        className="text-[11px]"
        style={{ color: "var(--error, var(--ink-soft))" }}
      >
        Auto-save failed: {props.errorMessage}
      </span>
    );
  }
  if (props.savedAt) {
    return (
      <span
        className="text-[11px]"
        style={{
          color: "var(--ink-muted)",
          fontFamily: "var(--font-mono)",
        }}
      >
        Auto-saved · {relativeTime(props.savedAt)}
      </span>
    );
  }
  return null;
}

function relativeTime(d: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
