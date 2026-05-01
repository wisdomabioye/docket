"use client";

import Link from "next/link";
import { useState } from "react";
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
 *   - Save → `output.update` mutation
 *   - Approve / Un-approve / Download PDF → ApprovalActions
 *   - Regenerate (with optional guidance) → RegeneratePanel
 *   - Version history list with Restore action → VersionHistory
 *
 * State held here: Tiptap dirty flag, Read/Edit mode, save error.
 * Server state (`output.get`) is mirrored once on mount via the RSC
 * page's `initialOutput` prop and refreshed via tRPC invalidations
 * after mutations succeed.
 */

export type InitialOutput = {
  id: string;
  outputType: OutputType;
  outputVersion: number;
  subgroupKey: string | null;
  content: string;
  attorneyApproved: boolean;
  approvedAt: string | null;
  updatedAt: string;
};

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
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [saveError, setSaveError] = useState<string | null>(null);
  const tiptap = useTiptapState();

  // Refresh `output.get` to pick up new versions after a successful
  // save / regenerate / restore. `staleTime: 0` so post-mutation
  // invalidations always trigger a refetch.
  const outputQuery = trpc.output.get.useQuery(
    { outputId: props.initialOutput.id },
    { staleTime: 0 },
  );
  const live = outputQuery.data ?? null;
  const currentMarkdown = live?.content ?? props.initialOutput.content;
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

  const updateMutation = trpc.output.update.useMutation({
    onSuccess: async () => {
      setSaveError(null);
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
    const md = tiptap.api.getMarkdown();
    if (md.trim().length === 0) {
      setSaveError(
        "Content cannot be empty — use Regenerate to draft fresh prose.",
      );
      return;
    }
    setSaveError(null);
    updateMutation.mutate({
      outputId: props.initialOutput.id,
      content: md,
    });
  }

  function handleCancel(): void {
    if (tiptap.isDirty && !window.confirm("Discard your edits?")) return;
    tiptap.api?.setMarkdown(currentMarkdown);
    setMode("read");
    setSaveError(null);
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
                    style={{ color: "var(--danger, var(--ink-soft))" }}
                  >
                    {saveError}
                  </span>
                ) : null}
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
                >
                  {updateMutation.isPending ? "Saving…" : "Save changes"}
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
                initialMarkdown={currentMarkdown}
                readOnly={mode === "read"}
                onDirtyChange={tiptap.setDirty}
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
