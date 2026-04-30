"use client";

import type { Editor } from "@tiptap/react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * Stage 11 γ Tiptap toolbar — twelve buttons over the StarterKit
 * commands the existing editor already supports. No new Tiptap
 * extensions, no sanitiser changes — every command + every emitted
 * tag is already in `lib/markdown.ts:ALLOWED_TAGS`.
 *
 * Renders inline above the editor body. `editor` is the live Tiptap
 * instance; pass `null` for the loading state and the toolbar renders
 * disabled. `disabled` (top-level prop) overrides per the read-only
 * mode used by the panel.
 */

export type OutputEditorToolbarProps = {
  editor: Editor | null;
  disabled?: boolean;
};

export function OutputEditorToolbar(
  props: OutputEditorToolbarProps,
): React.ReactElement {
  const e = props.editor;
  const off = props.disabled || !e;

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
      role="toolbar"
      aria-label="Editor formatting"
      style={{
        borderColor: "var(--border, rgba(0,0,0,0.08))",
        background: "var(--surface-sunken, rgba(0,0,0,0.02))",
      }}
    >
      <Group>
        <Btn
          label="B"
          srLabel="Bold"
          active={!!e?.isActive("bold")}
          disabled={off}
          onClick={() => e?.chain().focus().toggleBold().run()}
          weight="bold"
        />
        <Btn
          label="I"
          srLabel="Italic"
          active={!!e?.isActive("italic")}
          disabled={off}
          onClick={() => e?.chain().focus().toggleItalic().run()}
          weight="italic"
        />
        <Btn
          label="S"
          srLabel="Strike-through"
          active={!!e?.isActive("strike")}
          disabled={off}
          onClick={() => e?.chain().focus().toggleStrike().run()}
          weight="strike"
        />
      </Group>
      <Sep />
      <Group>
        <Btn
          label="H1"
          srLabel="Heading 1"
          active={!!e?.isActive("heading", { level: 1 })}
          disabled={off}
          onClick={() =>
            e?.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <Btn
          label="H2"
          srLabel="Heading 2"
          active={!!e?.isActive("heading", { level: 2 })}
          disabled={off}
          onClick={() =>
            e?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <Btn
          label="H3"
          srLabel="Heading 3"
          active={!!e?.isActive("heading", { level: 3 })}
          disabled={off}
          onClick={() =>
            e?.chain().focus().toggleHeading({ level: 3 }).run()
          }
        />
      </Group>
      <Sep />
      <Group>
        <Btn
          label="•"
          srLabel="Bullet list"
          active={!!e?.isActive("bulletList")}
          disabled={off}
          onClick={() => e?.chain().focus().toggleBulletList().run()}
        />
        <Btn
          label="1."
          srLabel="Numbered list"
          active={!!e?.isActive("orderedList")}
          disabled={off}
          onClick={() => e?.chain().focus().toggleOrderedList().run()}
        />
        <Btn
          iconName="quote"
          srLabel="Blockquote"
          active={!!e?.isActive("blockquote")}
          disabled={off}
          onClick={() => e?.chain().focus().toggleBlockquote().run()}
        />
        <Btn
          iconName="link"
          srLabel="Insert / edit link"
          active={!!e?.isActive("link")}
          disabled={off}
          onClick={() => promptLink(e)}
        />
      </Group>
      <Sep />
      <Group>
        <Btn
          label="↶"
          srLabel="Undo"
          disabled={off || !e?.can().undo()}
          onClick={() => e?.chain().focus().undo().run()}
        />
        <Btn
          label="↷"
          srLabel="Redo"
          disabled={off || !e?.can().redo()}
          onClick={() => e?.chain().focus().redo().run()}
        />
      </Group>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function Group(props: { children: React.ReactNode }): React.ReactElement {
  return <div className="flex items-center gap-0.5">{props.children}</div>;
}

function Sep(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="mx-1 h-5 w-px"
      style={{ background: "var(--border, rgba(0,0,0,0.12))" }}
    />
  );
}

function Btn(props: {
  /** Text label for letter-style buttons (B / I / H1 / 1.). */
  label?: string;
  /** Lucide icon name for icon-style buttons (quote, link). Mutually
   *  exclusive with `label`. */
  iconName?: IconName;
  srLabel: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  weight?: "bold" | "italic" | "strike";
}): React.ReactElement {
  // Tiptap's `chain().focus()` requires the editor to be in the DOM
  // when invoked; pointing the button to onMouseDown + preventDefault
  // ensures the click doesn't yank focus away first.
  return (
    <button
      type="button"
      aria-label={props.srLabel}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (props.disabled) return;
        props.onClick();
      }}
      className={cn(
        "h-7 min-w-[28px] rounded-sm px-2 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40",
        "hover:bg-[var(--surface,rgba(0,0,0,0.04))]",
      )}
      style={{
        color: props.active ? "var(--ink)" : "var(--ink-muted)",
        background: props.active
          ? "var(--surface, rgba(0,0,0,0.06))"
          : "transparent",
        fontWeight: props.weight === "bold" ? 700 : 500,
        fontStyle: props.weight === "italic" ? "italic" : "normal",
        textDecoration:
          props.weight === "strike" ? "line-through" : "none",
      }}
    >
      {props.iconName ? (
        <Icon name={props.iconName} size={14} strokeWidth={1.75} />
      ) : (
        props.label
      )}
    </button>
  );
}

function promptLink(editor: Editor | null): void {
  if (!editor) return;
  const previous = editor.getAttributes("link").href as string | undefined;
  // Browser prompt is acceptable Phase 1 — Stage 12 polish can swap in
  // a Radix popover with URL validation.
  const url = window.prompt("Link URL (http / https only)", previous ?? "");
  if (url === null) return;
  if (url === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  // Drop unsafe protocols defensively. The regex `/^https?:\/\//`
  // would accept `https://` alone or `https:// foo` — use the URL
  // constructor for real host-presence validation. Tiptap's Link
  // extension's `protocols` config is a second line of defense.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  if (!parsed.hostname) return;
  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: parsed.toString() })
    .run();
}
