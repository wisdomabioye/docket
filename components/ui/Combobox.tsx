"use client";

import { useId, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

/**
 * Accessible searchable select. Single-select returns the chosen option's
 * `value` (string); multi-select returns `string[]`. Both modes share the
 * same popover/list/keyboard plumbing — the consumer picks via the
 * discriminated `mode` prop so callers don't accidentally mix shapes.
 *
 * Styling mirrors `DateInput` (CSS vars + border/danger tokens) so a
 * Combobox slotted into the IntakeWizard's `FieldRow` is visually
 * indistinguishable from the existing text inputs.
 */

export type ComboboxOption = Readonly<{
  /** Stable wire value. Stored in form state. */
  value: string;
  /** Display label. Used for both the trigger text and search match. */
  label: string;
}>;

type SharedProps = {
  options: ReadonlyArray<ComboboxOption>;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Forwarded to the trigger for screen-reader association when no
   *  `<label htmlFor={id}>` is paired. */
  "aria-label"?: string;
  /** ID of the element describing the trigger's error/hint. */
  "aria-describedby"?: string;
  /** When true, applies the danger border + `aria-invalid` flag. */
  invalid?: boolean;
  /** Class merged onto the trigger element. */
  className?: string;
};

type SingleProps = SharedProps & {
  mode?: "single";
  value: string;
  onChange: (next: string) => void;
};

type MultiProps = SharedProps & {
  mode: "multi";
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
};

export type ComboboxProps = SingleProps | MultiProps;

export function Combobox(props: ComboboxProps): React.ReactElement {
  const reactId = useId();
  const id = props.id ?? `combobox-${reactId}`;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdxRaw, setActiveIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const isMulti = props.mode === "multi";
  const selectedValues = useMemo(
    () => (isMulti ? new Set(props.value) : new Set([props.value])),
    [isMulti, props.value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return props.options;
    return props.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [props.options, query]);

  function handleOpenChange(next: boolean) {
    if (props.disabled) return;
    setOpen(next);
    if (next) {
      // Focus the search input as soon as the popover opens — opening
      // the menu should put the user in "filter mode" without an extra
      // click.
      queueMicrotask(() => searchRef.current?.focus());
    } else {
      setQuery("");
      setActiveIdx(0);
    }
  }

  // Clamp without setState — keeps the active row inside the filtered
  // range as the query shrinks the list. The raw cursor is preserved
  // so the user's last position can re-emerge if they backspace the
  // query.
  const activeIdx =
    filtered.length === 0
      ? 0
      : Math.min(activeIdxRaw, filtered.length - 1);

  function commit(option: ComboboxOption) {
    if (isMulti) {
      const next = new Set(props.value);
      if (next.has(option.value)) next.delete(option.value);
      else next.add(option.value);
      // Preserve catalogue order so the chip strip stays stable as the
      // user adds/removes selections.
      const ordered = props.options
        .map((o) => o.value)
        .filter((v) => next.has(v));
      props.onChange(ordered);
      // Multi keeps the popover open — attorneys typically select
      // multiple bar states in one pass.
      return;
    }
    props.onChange(option.value);
    setOpen(false);
  }

  function removeChip(value: string) {
    if (!isMulti) return;
    props.onChange(props.value.filter((v) => v !== value));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIdx];
      if (opt) commit(opt);
    } else if (e.key === "Backspace" && query.length === 0 && isMulti) {
      // Backspace on an empty search field pops the last chip — common
      // pattern in tag inputs (GitHub labels, GMail recipients).
      const last = props.value[props.value.length - 1];
      if (last) removeChip(last);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const triggerStyle = {
    borderColor: props.invalid
      ? "var(--danger, #b1330e)"
      : "var(--border, rgba(0,0,0,0.15))",
    background: "var(--surface, white)",
    color: "var(--ink)",
  } as const;

  const labelForSingle = isMulti
    ? null
    : props.options.find((o) => o.value === props.value)?.label ?? null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={props.disabled}
          aria-label={props["aria-label"]}
          {...(props.invalid ? { "aria-invalid": true as const } : {})}
          {...(props["aria-describedby"]
            ? { "aria-describedby": props["aria-describedby"] }
            : {})}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm disabled:opacity-60",
            props.className,
          )}
          style={triggerStyle}
        >
          {isMulti ? (
            props.value.length === 0 ? (
              <span style={{ color: "var(--ink-muted)" }}>
                {props.placeholder ?? "Select…"}
              </span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {props.value.map((v) => {
                  const opt = props.options.find((o) => o.value === v);
                  return (
                    <span
                      key={v}
                      className="mono rounded-sm px-1.5 py-0.5 text-[10px]"
                      style={{
                        background: "var(--surface-sunken, rgba(0,0,0,0.06))",
                        color: "var(--ink)",
                      }}
                    >
                      {opt?.label ?? v}
                    </span>
                  );
                })}
              </span>
            )
          ) : labelForSingle ? (
            <span>{labelForSingle}</span>
          ) : (
            <span style={{ color: "var(--ink-muted)" }}>
              {props.placeholder ?? "Select…"}
            </span>
          )}
          <Icon name="chevron-down" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border shadow-lg"
          style={{
            borderColor: "var(--border, rgba(0,0,0,0.15))",
            background: "var(--surface, white)",
          }}
        >
          <div
            className="border-b p-2"
            style={{ borderColor: "var(--border, rgba(0,0,0,0.08))" }}
          >
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              aria-autocomplete="list"
              aria-controls={listboxId}
              className="w-full rounded-sm border px-2 py-1 text-sm"
              style={{
                borderColor: "var(--border, rgba(0,0,0,0.12))",
                background: "var(--surface, white)",
                color: "var(--ink)",
              }}
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable={isMulti}
            className="max-h-64 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li
                className="px-3 py-2 text-xs"
                style={{ color: "var(--ink-muted)" }}
              >
                No matches.
              </li>
            ) : (
              filtered.map((opt, idx) => {
                const selected = selectedValues.has(opt.value);
                const active = idx === activeIdx;
                return (
                  <li key={opt.value} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => commit(opt)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm"
                      style={{
                        background: active
                          ? "var(--surface-sunken, rgba(0,0,0,0.04))"
                          : "transparent",
                        color: "var(--ink)",
                      }}
                    >
                      <span>{opt.label}</span>
                      {selected ? (
                        <span
                          aria-hidden
                          className="mono text-[10px]"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
