"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc/react";
import {
  ExhibitIndexEntrySchema,
  ExhibitIndexSchema,
} from "@/server/db/schema/zod/exhibit-index";

/**
 * Structured editor for `exhibit_index` outputs. The canonical
 * `case_outputs.content` is JSON conforming to `ExhibitIndexSchema`;
 * this component edits that shape directly via a typed form rather
 * than round-tripping through markdown (which would lose the JSON
 * contract that downstream `_context.ts` parsers depend on).
 *
 * Design principles:
 *   - `documentId` is the FK to `case_documents`; the user can pick a
 *     document when adding a row but cannot mutate `documentId` once a
 *     row exists (changing the document a row points at is a remove +
 *     re-add).
 *   - Rows render in array order; reorder via up/down arrows. Drag-
 *     and-drop is intentionally deferred — keeps commit C boundary
 *     tight and the keyboard-only UX is identical to DnD's a11y mode.
 *   - `supportsCriteria` is a chip list of free-text criterion ids;
 *     a future enhancement can multi-select against the evidence
 *     plan's criteria taxonomy.
 *   - Imperative API mirrors `TiptapEditor` (`getValue` + `setContent`)
 *     so `OutputDetailPanel` can dispatch between the two without
 *     branching on output-type-specific call shapes outside the
 *     dispatcher.
 *   - Save-time validation goes through `ExhibitIndexSchema.parse` on
 *     `getValue()` — invalid form state returns `null`; the host
 *     surfaces the error and blocks the mutation.
 *
 * Drafts: out of scope for this commit. Edits live in component state
 * until Save commits a new version. A follow-up will add structured
 * draft persistence (separate code path from markdown drafts).
 */

type Entry = z.infer<typeof ExhibitIndexEntrySchema>;
type ExhibitIndex = z.infer<typeof ExhibitIndexSchema>;

export type ExhibitIndexEditorProps = {
  caseId: string;
  /** Initial JSON content as stored in `case_outputs.content`. */
  initialContent: string;
  readOnly: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onReady?: (api: ExhibitIndexEditorApi) => void;
};

export type ExhibitIndexEditorApi = {
  /** Returns the current value if it passes `ExhibitIndexSchema`,
   *  otherwise null. The host should surface a user-visible error and
   *  refuse to save when null. */
  getValue: () => ExhibitIndex | null;
  /** Replaces the editor state — used after a successful save / regen
   *  / restore so the editor reflects the new canonical version. */
  setContent: (json: string) => void;
};

/** Parse-and-default a stored content string into a render-able list
 *  of entries. Malformed JSON / schema-violating payloads surface as
 *  an empty list — the editor never crashes; the host's "could not
 *  parse" banner is what alerts the user. */
function parseInitialEntries(json: string): {
  entries: Entry[];
  parseFailed: boolean;
} {
  if (json.trim().length === 0) return { entries: [], parseFailed: false };
  try {
    const raw: unknown = JSON.parse(json);
    const result = ExhibitIndexSchema.safeParse(raw);
    if (result.success) return { entries: [...result.data.entries], parseFailed: false };
    return { entries: [], parseFailed: true };
  } catch {
    return { entries: [], parseFailed: true };
  }
}

/** Stable ascending exhibit labels. Gaps in alphabet are tolerated —
 *  the user can manually retype a label to override. */
function nextDefaultLabel(existing: ReadonlyArray<Entry>): string {
  // 26 letters, then "Exhibit AA"... — petitions rarely cross 26 but
  // the wrap-around keeps the form functional rather than throwing.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const used = new Set(existing.map((e) => e.label.replace(/^Exhibit\s+/i, "").trim()));
  for (const letter of letters) {
    if (!used.has(letter)) return `Exhibit ${letter}`;
  }
  // Past Z — append a 2-letter suffix.
  for (const a of letters) {
    for (const b of letters) {
      const code = `${a}${b}`;
      if (!used.has(code)) return `Exhibit ${code}`;
    }
  }
  return `Exhibit ${existing.length + 1}`;
}

export function ExhibitIndexEditor(
  props: ExhibitIndexEditorProps,
): ReactElement {
  const onDirtyChangeRef = useRef(props.onDirtyChange);
  const onReadyRef = useRef(props.onReady);
  useEffect(() => {
    onDirtyChangeRef.current = props.onDirtyChange;
    onReadyRef.current = props.onReady;
  });

  const [{ entries: initialEntries, parseFailed }, setInitial] = useState(() =>
    parseInitialEntries(props.initialContent),
  );
  const [entries, setEntries] = useState<Entry[]>(initialEntries);

  // Re-sync when the prop changes (parent swaps versions / save returns).
  // Using JSON-string equality is fine here — the wire format IS a
  // string, and we only resync on actual prop swaps.
  const lastSyncedRef = useRef(props.initialContent);
  useEffect(() => {
    if (lastSyncedRef.current === props.initialContent) return;
    lastSyncedRef.current = props.initialContent;
    const parsed = parseInitialEntries(props.initialContent);
    setInitial(parsed);
    setEntries(parsed.entries);
    onDirtyChangeRef.current?.(false);
  }, [props.initialContent]);

  // Imperative API — exposed once on mount, stable identity so the
  // host's `setApi` setter doesn't loop. Uses refs to read latest
  // entries inside `getValue` without forcing re-renders.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    const api: ExhibitIndexEditorApi = {
      getValue: () => {
        const candidate = { entries: entriesRef.current };
        const result = ExhibitIndexSchema.safeParse(candidate);
        return result.success ? result.data : null;
      },
      setContent: (json) => {
        const parsed = parseInitialEntries(json);
        setInitial(parsed);
        setEntries(parsed.entries);
        onDirtyChangeRef.current?.(false);
      },
    };
    onReadyRef.current?.(api);
    // Mount-only; consumers re-call setApi on each onReady invocation
    // anyway, and stable identity prevents the panel's setApi setter
    // from looping.
  }, []);

  const documentsQuery = trpc.document.list.useQuery({ caseId: props.caseId });

  function markDirty(): void {
    onDirtyChangeRef.current?.(true);
  }

  function updateEntry(idx: number, patch: Partial<Entry>): void {
    setEntries((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    );
    markDirty();
  }

  function removeEntry(idx: number): void {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    markDirty();
  }

  function moveEntry(idx: number, direction: -1 | 1): void {
    setEntries((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(idx, 1);
      if (!row) return prev;
      next.splice(target, 0, row);
      return next;
    });
    markDirty();
  }

  function addEntryFromDocument(documentId: string, filename: string): void {
    setEntries((prev) => [
      ...prev,
      {
        label: nextDefaultLabel(prev),
        documentId,
        filename,
        description: "",
        supportsCriteria: [],
      },
    ]);
    markDirty();
  }

  // Indexed-already set so the picker hides documents already used.
  // Same doc could legitimately be referenced by two exhibits in
  // theory, but the typical case is one-to-one; the picker stays
  // simpler with the deduplication and the user can still manually
  // re-add via the "all documents" toggle if needed.
  const alreadyIndexed = useMemo(
    () => new Set(entries.map((e) => e.documentId)),
    [entries],
  );

  if (parseFailed) {
    return (
      <div className="p-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        <p style={{ color: "var(--danger, var(--ink))" }}>
          <strong>Could not parse exhibit index.</strong> The stored
          content does not match the expected schema. Use Regenerate to
          rebuild it from your uploaded documents.
        </p>
        <pre
          className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-sm border p-3 text-[11px]"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-sunken)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {props.initialContent}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          No exhibits yet. Add documents from the case to build the
          index.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry, idx) => (
            <li
              key={`${entry.documentId}-${idx}`}
              className="rounded-sm border p-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
              }}
            >
              <div className="flex items-start gap-2">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => moveEntry(idx, -1)}
                    disabled={props.readOnly || idx === 0}
                    aria-label={`Move ${entry.label} up`}
                    className="rounded-sm border px-1 text-xs disabled:opacity-30"
                    style={{ borderColor: "var(--border)" }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveEntry(idx, 1)}
                    disabled={props.readOnly || idx === entries.length - 1}
                    aria-label={`Move ${entry.label} down`}
                    className="rounded-sm border px-1 text-xs disabled:opacity-30"
                    style={{ borderColor: "var(--border)" }}
                  >
                    ↓
                  </button>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <FieldText
                      label="Label"
                      value={entry.label}
                      readOnly={props.readOnly}
                      onChange={(v) => updateEntry(idx, { label: v })}
                    />
                    <FieldText
                      label="Filename"
                      value={entry.filename}
                      readOnly={props.readOnly}
                      onChange={(v) => updateEntry(idx, { filename: v })}
                    />
                  </div>
                  <FieldTextarea
                    label="Description"
                    value={entry.description}
                    readOnly={props.readOnly}
                    onChange={(v) => updateEntry(idx, { description: v })}
                  />
                  <CriteriaChips
                    label="Supports criteria"
                    value={entry.supportsCriteria}
                    readOnly={props.readOnly}
                    onChange={(v) =>
                      updateEntry(idx, { supportsCriteria: v })
                    }
                  />
                  <p
                    className="text-[10px]"
                    style={{
                      color: "var(--ink-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    documentId: {entry.documentId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeEntry(idx)}
                  disabled={props.readOnly}
                  aria-label={`Remove ${entry.label}`}
                  className="rounded-sm border px-2 py-1 text-xs disabled:opacity-30"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--ink-soft)",
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!props.readOnly ? (
        <DocumentPicker
          documents={documentsQuery.data ?? []}
          alreadyIndexed={alreadyIndexed}
          loading={documentsQuery.isLoading}
          onPick={addEntryFromDocument}
        />
      ) : null}
    </div>
  );
}

/** Convenience for the host: state pair tracking the imperative API
 *  + dirty flag. Mirrors `useTiptapState` so `OutputDetailPanel` can
 *  hold one shape for either editor. */
export function useExhibitIndexEditorState(): {
  isDirty: boolean;
  setDirty: (v: boolean) => void;
  api: ExhibitIndexEditorApi | null;
  setApi: (a: ExhibitIndexEditorApi) => void;
} {
  const [isDirty, setDirty] = useState(false);
  const [api, setApi] = useState<ExhibitIndexEditorApi | null>(null);
  return { isDirty, setDirty, api, setApi };
}

// ──────────────────────────────────────────────────────────────
// Sub-components — kept private to this file. Keeping them here
// rather than splitting into a folder of one-line files matches
// the existing pattern (TiptapEditor + OutputEditorToolbar are
// separated only because the toolbar is reused by Tiptap's API).
// ──────────────────────────────────────────────────────────────

type FieldTextProps = {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
};

function FieldText(props: FieldTextProps): ReactElement {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span style={{ color: "var(--ink-muted)" }}>{props.label}</span>
      <input
        type="text"
        value={props.value}
        readOnly={props.readOnly}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-sm border px-2 py-1 text-sm disabled:opacity-50 read-only:opacity-70"
        style={{
          borderColor: "var(--border)",
          background: "var(--surface-sunken)",
        }}
      />
    </label>
  );
}

type FieldTextareaProps = FieldTextProps;

function FieldTextarea(props: FieldTextareaProps): ReactElement {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span style={{ color: "var(--ink-muted)" }}>{props.label}</span>
      <textarea
        value={props.value}
        readOnly={props.readOnly}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        className="rounded-sm border px-2 py-1 text-sm read-only:opacity-70"
        style={{
          borderColor: "var(--border)",
          background: "var(--surface-sunken)",
        }}
      />
    </label>
  );
}

type CriteriaChipsProps = {
  label: string;
  value: string[];
  readOnly: boolean;
  onChange: (v: string[]) => void;
};

function CriteriaChips(props: CriteriaChipsProps): ReactElement {
  const [draft, setDraft] = useState("");
  function commit(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    if (props.value.includes(trimmed)) {
      setDraft("");
      return;
    }
    props.onChange([...props.value, trimmed]);
    setDraft("");
  }
  function remove(target: string): void {
    props.onChange(props.value.filter((v) => v !== target));
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span style={{ color: "var(--ink-muted)" }}>{props.label}</span>
      <div className="flex flex-wrap gap-1">
        {props.value.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface-sunken)",
            }}
          >
            {c}
            {!props.readOnly ? (
              <button
                type="button"
                onClick={() => remove(c)}
                aria-label={`Remove ${c}`}
                style={{ color: "var(--ink-soft)" }}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {!props.readOnly ? (
          <input
            type="text"
            value={draft}
            placeholder="Add criterion · Enter"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={() => commit()}
            className="min-w-[160px] flex-1 rounded-sm border px-2 py-0.5 text-[11px]"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

type DocumentPickerProps = {
  documents: ReadonlyArray<{ id: string; originalFilename: string }>;
  alreadyIndexed: ReadonlySet<string>;
  loading: boolean;
  onPick: (documentId: string, filename: string) => void;
};

function DocumentPicker(props: DocumentPickerProps): ReactElement {
  const [selected, setSelected] = useState("");
  const available = props.documents.filter(
    (d) => !props.alreadyIndexed.has(d.id),
  );
  return (
    <div
      className="flex items-end gap-2 rounded-sm border p-3"
      style={{
        borderColor: "var(--border)",
        background: "var(--surface)",
      }}
    >
      <label className="flex-1 text-xs">
        <span style={{ color: "var(--ink-muted)" }}>Add a document</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={props.loading || available.length === 0}
          className="mt-1 w-full rounded-sm border px-2 py-1 text-sm"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-sunken)",
          }}
        >
          <option value="">
            {props.loading
              ? "Loading documents…"
              : available.length === 0
                ? "All uploaded documents are already in the index"
                : "Choose a document…"}
          </option>
          {available.map((d) => (
            <option key={d.id} value={d.id}>
              {d.originalFilename}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={selected === ""}
        onClick={() => {
          const doc = available.find((d) => d.id === selected);
          if (!doc) return;
          props.onPick(doc.id, doc.originalFilename);
          setSelected("");
        }}
        className="rounded-sm border px-3 py-1.5 text-xs disabled:opacity-50"
        style={{
          borderColor: "var(--border)",
          color: "var(--ink)",
        }}
      >
        Add to index
      </button>
    </div>
  );
}
