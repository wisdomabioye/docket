import { Icon } from "@/components/ui/Icon";

/**
 * Stage 11 β checklist primitive. Mockup `documents.html .checklist`
 * (l. 354-372) — list of items, each with a tick / open dot, label,
 * optional progress fragment, and optional right-aligned tag pill.
 *
 * Three states per row:
 *   - `done` — solid green tick, label in normal color.
 *   - `open` — outlined circle, label muted.
 *   - `unknown` — `?` glyph, label muted, "needs manual check" hint.
 *     Used when the data exists but we can't auto-verify (e.g. passport
 *     bio page maps to `documentType=other`, no enum bucket).
 *
 * Tag pill on the right is for criterion attribution ("CRIT 5") or
 * progress hint ("2 of 3"). Two pill tones: `info` (default), `warning`
 * for partial / overdue.
 *
 * Generic enough to reuse outside the Documents rail — onboarding
 * checklists, post-deploy verification, etc.
 */

export type ChecklistItemStatus = "done" | "open" | "unknown";

export type ChecklistItem = {
  /** Stable React key. */
  key: string;
  label: string;
  status: ChecklistItemStatus;
  /** Right-aligned label (e.g. "CRIT 5", "2 of 3", "OCR FAIL"). */
  tag?: string;
  /** Tag color tone. Defaults to neutral muted. */
  tagTone?: "info" | "warning";
};

export type ChecklistProps = {
  items: ReadonlyArray<ChecklistItem>;
};

export function Checklist(props: ChecklistProps): React.ReactElement {
  return (
    <ul className="space-y-2" data-component="checklist">
      {props.items.map((item) => (
        <li
          key={item.key}
          className="flex items-baseline gap-2 text-sm"
          data-status={item.status}
        >
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <StatusGlyph status={item.status} />
          </span>
          <span
            className="flex-1 truncate"
            style={{
              color:
                item.status === "done"
                  ? "var(--ink)"
                  : "var(--ink-muted)",
              textDecoration:
                item.status === "done" ? "none" : "none",
            }}
          >
            {item.label}
          </span>
          {item.tag ? (
            <Tag tag={item.tag} {...(item.tagTone ? { tone: item.tagTone } : {})} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StatusGlyph(props: {
  status: ChecklistItemStatus;
}): React.ReactElement {
  if (props.status === "done") {
    return (
      <span
        aria-label="Done"
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{
          background: "var(--success, #1f6b3d)",
          color: "var(--cream, white)",
        }}
      >
        <Icon name="check" size={10} strokeWidth={2.5} />
      </span>
    );
  }
  if (props.status === "unknown") {
    return (
      <span
        aria-label="Manual verification needed"
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold"
        style={{
          background: "var(--surface-sunken, rgba(0,0,0,0.05))",
          color: "var(--ink-muted)",
          border: "1px solid var(--border, rgba(0,0,0,0.15))",
        }}
      >
        ?
      </span>
    );
  }
  return (
    <span
      aria-label="Open"
      className="block h-3.5 w-3.5 rounded-full border"
      style={{ borderColor: "var(--border, rgba(0,0,0,0.25))" }}
    />
  );
}

function Tag(props: {
  tag: string;
  tone?: "info" | "warning";
}): React.ReactElement {
  const palette =
    props.tone === "warning"
      ? {
          bg: "var(--warning-soft, rgba(177,131,14,0.1))",
          fg: "var(--warning, #8a4a13)",
        }
      : {
          bg: "var(--surface-sunken, rgba(0,0,0,0.05))",
          fg: "var(--ink-muted)",
        };
  return (
    <span
      className="mono shrink-0 rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wider"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {props.tag}
    </span>
  );
}
