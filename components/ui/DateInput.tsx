"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { format, parseISO } from "date-fns";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

/**
 * Drop-in replacement for `<input type="date">`.
 *
 * The wire contract matches the native input verbatim — `value` is
 * either an empty string or a `yyyy-mm-dd` ISO date — so swapping
 * this in at the IntakeWizard FieldRow does not change form state,
 * persistence, or downstream Zod validators.
 *
 * UX layers (in priority order):
 *   1. **Typeable masked input** — `MM/DD/YYYY` with auto-inserted
 *      slashes. Fastest path for attorneys who know the exact value
 *      (DOB, document expiry). Validates on blur; invalid input
 *      reverts to the last good value.
 *   2. **Calendar popover** — opens via the inline button or the
 *      down-arrow keyboard shortcut on the input. Built on
 *      `react-day-picker` v9 + Radix Popover so a11y and keyboard
 *      navigation come for free.
 *
 * Out-of-range dates are disabled in both layers — `min`/`max`
 * prune the typed value on blur AND the calendar's selectable
 * range.
 */

export type DateInputProps = {
  /** ISO `yyyy-mm-dd`, or empty string when unset. */
  value: string;
  onChange: (next: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Inclusive ISO `yyyy-mm-dd` lower bound. */
  min?: string;
  /** Inclusive ISO `yyyy-mm-dd` upper bound. */
  max?: string;
  /** Forwarded to the typeable input for accessibility when no
   *  `<label htmlFor={id}>` is paired. */
  "aria-label"?: string;
  /** ID of the element describing this input's error/hint, forwarded
   *  to `aria-describedby` when present. Parent form is responsible
   *  for rendering the message and matching the id. */
  "aria-describedby"?: string;
  /** Override the input's class. Falls through to the same Tailwind
   *  classes used by the native input the IntakeWizard ships today. */
  className?: string;
  /** Forwarded to the input — for caller-controlled focus state. */
  autoFocus?: boolean;
  /** Caller-managed error state. When truthy, flips `aria-invalid`
   *  and colors the input border with `--danger`. The message text
   *  itself is the parent's responsibility (see `aria-describedby`). */
  invalid?: boolean;
  /** Fires when a blur/Enter-committed value fails to parse or falls
   *  outside `min`/`max`. The input still reverts to the last-valid
   *  value (the form state is the source of truth), so this is purely
   *  a signal the parent can surface as a transient error. */
  onInvalid?: (reason: "invalid_date" | "out_of_range") => void;
};

/**
 * Apply the `MM/DD/YYYY` mask. Idempotent — running the result back
 * through the function is a no-op. Strips non-digits; truncates at
 * 8 digits.
 */
function applyMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Parse a fully-typed `MM/DD/YYYY` string. Returns null for partials
 * or for invalid calendar dates (Feb 30, etc. — JS `Date` rolls those
 * over; we reject by checking the constructed date round-trips).
 */
function parseMaskedDate(masked: string): Date | null {
  const m = masked.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, mmStr, ddStr, yyyyStr] = m;
  const month = Number.parseInt(mmStr!, 10) - 1;
  const day = Number.parseInt(ddStr!, 10);
  const year = Number.parseInt(yyyyStr!, 10);
  if (year < 1900 || year > 2999) return null;
  const d = new Date(year, month, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** ISO `yyyy-mm-dd` → masked `MM/DD/YYYY`. Empty in → empty out. */
function maskedFromIso(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function isWithinRange(
  d: Date,
  min: string | undefined,
  max: string | undefined,
): boolean {
  if (min) {
    const lo = parseISO(min);
    if (d < lo) return false;
  }
  if (max) {
    const hi = parseISO(max);
    if (d > hi) return false;
  }
  return true;
}

export function DateInput(props: DateInputProps): React.ReactElement {
  const reactId = useId();
  const id = props.id ?? `dateinput-${reactId}`;
  const [open, setOpen] = useState(false);
  // Local mask state — drives the input UI. Reseeds whenever the
  // upstream `value` changes (e.g. parent reset).
  const [text, setText] = useState(() => maskedFromIso(props.value));
  const lastValueRef = useRef(props.value);
  useEffect(() => {
    if (props.value !== lastValueRef.current) {
      lastValueRef.current = props.value;
      setText(maskedFromIso(props.value));
    }
  }, [props.value]);

  const selectedDate = props.value ? parseISO(props.value) : undefined;

  function commitText(masked: string) {
    if (masked === "") {
      props.onChange("");
      return;
    }
    const parsed = parseMaskedDate(masked);
    if (parsed === null) {
      // Couldn't be parsed at all (partial entry, Feb 30, etc.). Tell
      // the parent so it can surface a hint, then revert the visible
      // text — the form state never holds a half-typed string.
      props.onInvalid?.("invalid_date");
      setText(maskedFromIso(props.value));
      return;
    }
    if (!isWithinRange(parsed, props.min, props.max)) {
      props.onInvalid?.("out_of_range");
      setText(maskedFromIso(props.value));
      return;
    }
    props.onChange(format(parsed, "yyyy-MM-dd"));
  }

  function onCalendarSelect(d: Date | undefined) {
    if (!d) {
      props.onChange("");
      setText("");
      setOpen(false);
      return;
    }
    const iso = format(d, "yyyy-MM-dd");
    props.onChange(iso);
    setText(maskedFromIso(iso));
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => !props.disabled && setOpen(o)}>
      <div className="relative flex">
        <input
          id={id}
          name={props.name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="MM/DD/YYYY"
          value={text}
          disabled={props.disabled}
          required={props.required}
          autoFocus={props.autoFocus}
          aria-label={props["aria-label"]}
          {...(props.invalid ? { "aria-invalid": true as const } : {})}
          {...(props["aria-describedby"]
            ? { "aria-describedby": props["aria-describedby"] }
            : {})}
          onChange={(e) => setText(applyMask(e.target.value))}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText(e.currentTarget.value);
            } else if (e.key === "ArrowDown" && e.altKey) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "w-full rounded-md border px-3 py-2 pr-10 text-sm disabled:opacity-60",
            props.className,
          )}
          style={{
            borderColor: props.invalid
              ? "var(--danger, #b1330e)"
              : "var(--border, rgba(0,0,0,0.15))",
            background: "var(--surface, white)",
            color: "var(--ink)",
          }}
        />
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={props.disabled}
            aria-label="Open calendar"
            className="absolute inset-y-0 right-0 flex items-center px-2 text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            <Icon name="calendar" />
          </button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 rounded-md border bg-[var(--surface,white)] p-2 shadow-lg"
          style={{ borderColor: "var(--border, rgba(0,0,0,0.15))" }}
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={onCalendarSelect}
            {...(selectedDate ? { defaultMonth: selectedDate } : {})}
            disabled={[
              ...(props.min ? [{ before: parseISO(props.min) }] : []),
              ...(props.max ? [{ after: parseISO(props.max) }] : []),
            ]}
            captionLayout="dropdown"
            startMonth={
              props.min ? parseISO(props.min) : new Date(1900, 0)
            }
            endMonth={props.max ? parseISO(props.max) : new Date(2100, 11)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
