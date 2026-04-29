"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { htmlToMd, mdToSafeHtml } from "@/lib/markdown";

/**
 * Stage 08 prose editor. Tiptap is the editing surface; we serialize
 * to markdown on save (`htmlToMd`) and back to HTML on load
 * (`mdToSafeHtml`). The canonical content form is markdown — see
 * `lib/markdown.ts` for the round-trip rationale.
 *
 * Editor scope (locked from spec):
 *   - `StarterKit` with `image` + `codeBlock` disabled (legal docs are
 *     prose-only — pasted images and fenced code blocks would corrupt
 *     the markdown round-trip).
 *   - `Typography` for prettier punctuation (smart quotes, em dashes).
 *   - `Link` with an `href` filter that drops anything outside `http(s)`.
 *   - `Placeholder` for empty editor state.
 *
 * The editor manages its own DOM state; the host (output detail panel)
 * supplies the initial markdown + `readOnly` toggle and receives a
 * `getMarkdown()` accessor + `isDirty` boolean via callbacks. Saving is
 * EXPLICIT — the panel calls `getMarkdown()` from a Save button, then
 * the `output.update` mutation persists.
 */

export type TiptapEditorProps = {
  /** Initial markdown loaded into the editor. Re-renders when this
   *  prop changes (e.g. after a successful save the panel passes the
   *  new server-confirmed markdown back). */
  initialMarkdown: string;
  /** When true, the editor is non-editable (Tiptap's `editable` flag).
   *  Used for the "Read" mode in the toolbar. */
  readOnly: boolean;
  /** Called whenever the editor's content changes. The host tracks
   *  `isDirty` so the Regenerate button can prompt about unsaved edits. */
  onDirtyChange?: (isDirty: boolean) => void;
  /** Imperative accessor — the host calls this from the Save button to
   *  pull the current markdown for the mutation. The host pattern is
   *  via a ref-style hook (`useTiptapMarkdownRef`) below; this prop is
   *  the simpler, callback-style alternative. */
  onReady?: (api: TiptapEditorApi) => void;
};

/** Imperative API exposed to the host. Kept tiny on purpose — the
 *  editor's React component owns content state; the host orchestrates
 *  save / regenerate / restore. */
export type TiptapEditorApi = {
  /** Serializes the current editor HTML to markdown. */
  getMarkdown: () => string;
  /** Replaces the editor content (used after a successful save / regen
   *  / restore so the editor reflects the new canonical version). */
  setMarkdown: (md: string) => void;
};

export function TiptapEditor(props: TiptapEditorProps): ReactElement {
  // Stash callback props in a ref so the editor's `onUpdate` closure
  // sees the latest function without forcing the editor to re-create.
  // Without this, every parent render that produces a new
  // `onDirtyChange` reference would either stale-close (read the OLD
  // callback) or trigger an effect-driven editor rebuild.
  const onDirtyChangeRef = useRef(props.onDirtyChange);
  const onReadyRef = useRef(props.onReady);
  useEffect(() => {
    onDirtyChangeRef.current = props.onDirtyChange;
    onReadyRef.current = props.onReady;
  });

  const editor = useEditor({
    immediatelyRender: false, // Avoid Next.js SSR hydration mismatch
    editable: !props.readOnly,
    extensions: [
      StarterKit.configure({
        // Legal prose — drop the visual chrome we don't want in the round-trip.
        codeBlock: false,
      }),
      Typography,
      Link.configure({
        // Spec §17 + lib/markdown.ts: only http(s) hrefs survive. The
        // editor's UI link button + paste handler runs through this
        // validator before adding the mark.
        protocols: ["http", "https"],
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      Placeholder.configure({
        placeholder: "Edit the draft here. Save when finished.",
      }),
    ],
    content: mdToSafeHtml(props.initialMarkdown),
    onUpdate: () => {
      // ANY user-originated change is a dirty event. We deliberately
      // don't predicate on `editor.isEmpty` — clearing all content is
      // STILL a change from the saved baseline (and the save handler
      // rejects empty content anyway). Reset to `false` happens via
      // explicit `setMarkdown()` (after a save / version restore /
      // initial-prop swap), never via `onUpdate`.
      onDirtyChangeRef.current?.(true);
    },
  });

  // Re-sync editor content when `initialMarkdown` changes (host swapped
  // versions or the save returned). Diff against current to avoid
  // wasted reflows when the prop is referentially new but content-equal.
  useEffect(() => {
    if (!editor) return;
    const next = mdToSafeHtml(props.initialMarkdown);
    if (editor.getHTML() !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
      onDirtyChangeRef.current?.(false);
    }
  }, [editor, props.initialMarkdown]);

  // Editable flag toggle (Read ↔ Edit).
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.readOnly);
  }, [editor, props.readOnly]);

  // Expose imperative API once the editor is ready. Depends ONLY on
  // `editor` — onReady is read through the ref so a parent render with
  // a new onReady reference does NOT re-fire setApi (which would loop
  // through the parent's useState setter on every render).
  useEffect(() => {
    if (!editor) return;
    const callback = onReadyRef.current;
    if (!callback) return;
    callback({
      getMarkdown: () => htmlToMd(editor.getHTML()),
      setMarkdown: (md) => {
        editor.commands.setContent(mdToSafeHtml(md), { emitUpdate: false });
        onDirtyChangeRef.current?.(false);
      },
    });
  }, [editor]);

  if (!editor) {
    return (
      <div
        className="px-10 py-8 text-sm"
        style={{ color: "var(--ink-muted)" }}
      >
        Loading editor…
      </div>
    );
  }

  return <EditorContent editor={editor} className="tiptap-output" />;
}

/** Convenience: set up React state for the panel's "is dirty" + a ref
 *  to the editor API in one hook. The detail panel uses this. */
export function useTiptapState(): {
  isDirty: boolean;
  setDirty: (v: boolean) => void;
  api: TiptapEditorApi | null;
  setApi: (a: TiptapEditorApi) => void;
} {
  const [isDirty, setDirty] = useState(false);
  const [api, setApi] = useState<TiptapEditorApi | null>(null);
  return { isDirty, setDirty, api, setApi };
}
