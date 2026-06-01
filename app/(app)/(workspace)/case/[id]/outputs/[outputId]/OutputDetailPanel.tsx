"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui";
import {
  ApprovalActions,
  DisclaimerBanner,
  ExhibitIndexEditor,
  RegeneratePanel,
  TiptapEditor,
  VersionHistory,
  useExhibitIndexEditorState,
  useTiptapState,
} from "@/components/output";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";
import type { OutputType } from "@/server/services/computer/types";
import { isStructuredOutputType } from "@/lib/output-types";
import { computeReviewQueue } from "@/lib/review-queue";
import { parseHeadings } from "@/lib/toc";
import { recommenderLetterInstruction } from "@/lib/recommender-letter";
import { track } from "@/lib/analytics/client";

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
  /** Pre-formatted markdown for structured-output types
   *  (`exhibit_index`) whose canonical `content` is JSON. `null` for
   *  prose types — the panel falls back to `content` directly.
   *  Computed once on the server (the page RSC); the client never
   *  imports the formatter. */
  displayContent: string | null;
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
  const router = useRouter();
  const tiptap = useTiptapState();
  // The structured editor mounts only for `exhibit_index`. Hooks are
  // unconditional (React rules) — the `null` API stays harmless when
  // the prose Tiptap path is active. `dispatchedDirty` below selects
  // the right `isDirty` source.
  const exhibit = useExhibitIndexEditorState();

  // Refresh `output.get` to pick up new versions after a successful
  // save / regenerate / restore. `staleTime: 0` so post-mutation
  // invalidations always trigger a refetch.
  const outputQuery = trpc.output.get.useQuery(
    { outputId: props.initialOutput.id },
    { staleTime: 0 },
  );
  const live = outputQuery.data ?? null;
  const liveContent = live?.content ?? props.initialOutput.content;

  // Review queue (Stage 13): position + how many still need review, and
  // where "Next unreviewed →" goes. Filtered to the SAME set the grid and
  // the approvals tally use (current, non-deleted via `output.list`, and
  // non-internal) so the count never disagrees with the dashboard.
  // `staleTime: 0` + the post-approve `output.list` invalidation mean the
  // next-unreviewed target is recomputed from fresh data at click time —
  // no stale navigation after the approve flushes a new version id.
  const reviewQueueQuery = trpc.output.list.useQuery(
    { caseId: props.caseId },
    { staleTime: 0 },
  );
  const reviewQueue = useMemo(
    () =>
      computeReviewQueue(reviewQueueQuery.data ?? [], props.initialOutput.id),
    [reviewQueueQuery.data, props.initialOutput.id],
  );
  // Local const so TS narrows it to `string` inside the click handler.
  const nextUnreviewedId = reviewQueue.nextUnreviewedId;
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

  // Structured-output types (`exhibit_index`) store JSON in `content`
  // and need a typed form editor. Read mode renders the formatted
  // markdown via Tiptap (consistent with the package PDF render);
  // edit mode swaps in the structured form. Drafts for structured
  // types are not yet implemented — Save is the only mutation path.
  const isStructuredType = isStructuredOutputType(props.initialOutput.outputType);
  // For Tiptap (read-mode for structured types, both modes for prose).
  // Structured types always feed the formatted markdown; prose types
  // open to the draft if one is pending.
  const editorBaseline = isStructuredType
    ? props.initialOutput.displayContent ?? liveContent
    : hasPendingDraft && liveDraft !== null
      ? liveDraft
      : liveContent;
  const currentVersion = live?.outputVersion ?? props.initialOutput.outputVersion;

  // Section TOC (Stage 13 / #72) — parsed from the committed prose. The
  // right-rail list scrolls the rendered document to the matching <h*> by
  // text (no id injection / ProseMirror internals). Structured types have
  // no prose headings → empty toc → the rail section is hidden.
  const docRef = useRef<HTMLDivElement>(null);
  const toc = useMemo(
    () => (isStructuredType ? [] : parseHeadings(liveContent)),
    [isStructuredType, liveContent],
  );
  function scrollToSection(text: string): void {
    const root = docRef.current;
    if (!root) return;
    for (const h of root.querySelectorAll("h1, h2, h3")) {
      if (h.textContent?.trim() === text) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }
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
  // Structured types always open in Read because their draft path is
  // not yet implemented; a stale `draft_content` from before commit B
  // would otherwise nudge the panel into Edit on first load.
  const [mode, setMode] = useState<"read" | "edit">(() => {
    if (isStructuredType) return "read";
    return props.initialOutput.draftContent !== null &&
      props.initialOutput.draftContent !== props.initialOutput.content
      ? "edit"
      : "read";
  });
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

  // Analytics — emit once per (caseId, outputId) navigation. Tied to
  // the initial output id so that switching outputs (a fresh page nav)
  // re-fires; live refetches that change `outputVersion` do NOT, since
  // the deps array doesn't include the live snapshot.
  useEffect(() => {
    track({
      name: "output.viewed",
      properties: {
        case_id: props.caseId,
        output_id: props.initialOutput.id,
        output_type: props.initialOutput.outputType,
        version: props.initialOutput.outputVersion,
      },
    });
  }, [
    props.caseId,
    props.initialOutput.id,
    props.initialOutput.outputType,
    props.initialOutput.outputVersion,
  ]);

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

  /** Dirty hook for the structured editor. No autosave (structured
   *  drafts not yet implemented in this commit). */
  function handleStructuredDirtyChange(dirty: boolean): void {
    exhibit.setDirty(dirty);
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

  // Structured-output commit (currently `exhibit_index`). Same
  // post-success bookkeeping as `updateMutation` minus the markdown
  // draft cleanup — structured drafts are not yet implemented.
  const updateStructuredMutation = trpc.output.updateStructured.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      await Promise.all([
        utils.output.get.invalidate({ outputId: props.initialOutput.id }),
        utils.output.list.invalidate(),
        utils.output.listVersions.invalidate(),
      ]);
      exhibit.setDirty(false);
      setMode("read");
    },
    onError: (err) => setSaveError(err.message),
  });

  function handleSave(): void {
    if (isStructuredType) {
      handleSaveStructured();
      return;
    }
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

  function handleSaveStructured(): void {
    if (!exhibit.api) return;
    const value = exhibit.api.getValue();
    if (value === null) {
      setSaveError(
        "Exhibit index has invalid entries — every row needs a label, filename, and description.",
      );
      return;
    }
    setSaveError(null);
    // No in-flight autosave to chain behind for structured types
    // (drafts aren't implemented yet); fire the mutation directly.
    updateStructuredMutation.mutate({
      outputType: "exhibit_index",
      outputId: props.initialOutput.id,
      payload: value,
    });
  }

  function handleCancel(): void {
    const isDirty = isStructuredType ? exhibit.isDirty : tiptap.isDirty;
    if (isDirty && !window.confirm("Discard your edits?")) return;
    if (isStructuredType) {
      // Reset the structured editor to the canonical server content.
      // No clearDraft tRPC call — structured types don't write drafts.
      exhibit.api?.setContent(liveContent);
      exhibit.setDirty(false);
      setMode("read");
      setSaveError(null);
      return;
    }
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
        {reviewQueue.total > 0 ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-3 text-[11px]"
            style={{ color: "var(--ink-muted)" }}
            data-component="output-review-queue"
          >
            <span className="mono uppercase tracking-wider">
              {reviewQueue.position
                ? `${reviewQueue.position} of ${reviewQueue.total}`
                : `${reviewQueue.total} outputs`}
              {" · "}
              {reviewQueue.awaiting} awaiting review
            </span>
            {nextUnreviewedId ? (
              <button
                type="button"
                onClick={() =>
                  router.push(APP_ROUTES.output(props.caseId, nextUnreviewedId))
                }
                className="font-medium underline underline-offset-2"
                style={{ color: "var(--accent, var(--ink))" }}
              >
                Next unreviewed →
              </button>
            ) : reviewQueue.awaiting === 0 ? (
              <Link
                href={APP_ROUTES.casePackage(props.caseId)}
                className="font-medium underline underline-offset-2"
                style={{ color: "var(--accent, var(--ink))" }}
              >
                All approved — Package for filing →
              </Link>
            ) : null}
          </div>
        ) : null}
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
                {/* Autosave status only renders for the prose path —
                 *  structured types don't have an in-progress draft
                 *  buffer in this commit. */}
                {!isStructuredType ? (
                  <AutoSaveStatus
                    pending={saveDraftMutation.isPending}
                    errorMessage={autoSaveError}
                    savedAt={autoSavedAt}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={
                    isStructuredType
                      ? updateStructuredMutation.isPending
                      : updateMutation.isPending
                  }
                  className="px-2 py-1 text-[11px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={
                    isStructuredType
                      ? updateStructuredMutation.isPending || !exhibit.isDirty
                      : updateMutation.isPending || !tiptap.isDirty
                  }
                  className="rounded-sm px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  style={{ background: "var(--accent, var(--ink))" }}
                  title={
                    isStructuredType
                      ? "Commit the current exhibit index as a new version"
                      : "Commit current draft as a new version"
                  }
                >
                  {(isStructuredType
                    ? updateStructuredMutation.isPending
                    : updateMutation.isPending)
                    ? "Saving…"
                    : "Save version"}
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

          {/* Start of the recommendation-letter loop: this is where the
           *  attorney first holds the draft, so spell out send → sign →
           *  upload. Copy is the single source in lib/recommender-letter. */}
          {props.initialOutput.outputType ===
          "recommendation_letter_template" ? (
            <div
              role="note"
              className="mx-10 mb-3 rounded-sm border px-3 py-2 text-xs leading-relaxed"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface-sunken, rgba(0,0,0,0.03))",
                color: "var(--ink-soft, var(--ink))",
              }}
            >
              {recommenderLetterInstruction()}
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto">
            {/* Doc card. Width + chrome mirror `Docket-Meridian-UI/hifi/output-detail.html`
             *  `.doc-page` (max-w 640px, white bg, soft border + shadow).
             *  Padding is intentionally absent here — `.ProseMirror`
             *  (in globals.css) carries the 50px / 60px page padding so
             *  the toolbar (TiptapEditor's first sibling) sits flush at
             *  the top of the card, no nested chrome. */}
            <div
              ref={docRef}
              className="mx-auto my-4 max-w-[640px] overflow-hidden rounded-sm border bg-white"
              style={{
                borderColor: "var(--border)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {isStructuredType && mode === "edit" ? (
                // Structured-type edit path. The form mutates a typed
                // payload directly and commits via `updateStructured`;
                // it never round-trips through markdown.
                <ExhibitIndexEditor
                  caseId={props.caseId}
                  initialContent={liveContent}
                  readOnly={false}
                  onDirtyChange={handleStructuredDirtyChange}
                  onReady={exhibit.setApi}
                />
              ) : (
                <TiptapEditor
                  initialMarkdown={editorBaseline}
                  readOnly={mode === "read"}
                  onDirtyChange={handleDirtyChange}
                  onReady={tiptap.setApi}
                />
              )}
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

          {toc.length > 0 ? (
            <section className="space-y-2">
              <RailSectionHeader>Sections</RailSectionHeader>
              <ul className="space-y-1">
                {toc.map((entry, i) => (
                  <li key={`${i}-${entry.text}`}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(entry.text)}
                      className="block w-full truncate text-left text-xs hover:underline"
                      style={{
                        paddingLeft: `${(entry.level - 1) * 10}px`,
                        color: "var(--ink-soft, var(--ink))",
                      }}
                    >
                      {entry.text}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <RailSectionHeader>Actions</RailSectionHeader>
            <ApprovalActions
              outputId={props.initialOutput.id}
              attorneyApproved={attorneyApproved}
              onApprovalChange={(newOutputId) => {
                // Server-side `approveOutput` (W4.3) flushes any pending
                // draft into a new version BEFORE setting the approval
                // flag — which means the URL's `outputId` may now point
                // at the prior (non-current) version. Re-route so the
                // user lands on the row they just approved. Same id =
                // no-op (covers un-approve and the no-draft branch).
                if (newOutputId !== props.initialOutput.id) {
                  router.replace(
                    APP_ROUTES.output(props.caseId, newOutputId),
                  );
                }
              }}
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
