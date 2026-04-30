"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";

type Props = {
  caseId: string;
  initial: Record<string, string | undefined>;
  rowRevision: number;
  currentStatus: string;
  locked: boolean;
};

const FIELDS = [
  ["fullName", "Full name"],
  ["dateOfBirth", "Date of birth (YYYY-MM-DD)"],
  ["nationality", "Nationality"],
  ["currentLocation", "Current location"],
  ["occupation", "Occupation"],
  ["email", "Email"],
] as const;

export function IntakeForm(props: Props): React.ReactElement {
  const router = useRouter();
  const update = trpc.case.updateBeneficiary.useMutation();
  const complete = trpc.case.completeIntake.useMutation();
  const [isPending, startTransition] = useTransition();

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      FIELDS.map(([k]) => [k, props.initial[k] ?? ""]),
    ) as Record<string, string>,
  );
  const [notes, setNotes] = useState(props.initial.notes ?? "");

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onSave(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (props.locked) return;
    // Build patch from non-empty fields only — empty strings would fail
    // the procedure's `.min(1)` validators.
    const patch: Record<string, string> = {};
    for (const [key] of FIELDS) {
      const v = values[key]?.trim();
      if (v) patch[key] = v;
    }
    if (notes.trim()) patch.notes = notes.trim();

    update.mutate(
      {
        caseId: props.caseId,
        patch,
        expectedRowRevision: props.rowRevision,
      },
      { onSuccess: () => startTransition(() => router.refresh()) },
    );
  }

  function onComplete() {
    if (props.currentStatus !== "intake") return;
    complete.mutate(
      {
        caseId: props.caseId,
        expectedRowRevision: props.rowRevision,
      },
      {
        onSuccess: () =>
          startTransition(() => router.push(APP_ROUTES.case(props.caseId))),
      },
    );
  }

  const error = update.error?.message ?? complete.error?.message;
  const busy = update.isPending || complete.isPending || isPending;

  return (
    <form onSubmit={onSave} className="space-y-5">
      {FIELDS.map(([key, label]) => (
        <div key={key} className="space-y-1">
          <label htmlFor={key} className="block text-sm font-medium">
            {label}
          </label>
          <input
            id={key}
            value={values[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
            disabled={props.locked}
            className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2 text-sm disabled:bg-[var(--color-ink)]/5"
          />
        </div>
      ))}

      <div className="space-y-1">
        <label htmlFor="notes" className="block text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={props.locked}
          rows={4}
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2 text-sm disabled:bg-[var(--color-ink)]/5"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!props.locked && (
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-[var(--color-ink)] px-4 py-2 text-sm disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onComplete}
            disabled={busy || props.currentStatus !== "intake"}
            className="rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-cream)] disabled:opacity-50"
            title={
              props.currentStatus !== "intake"
                ? "Intake already submitted"
                : "Submit and move to document upload"
            }
          >
            {complete.isPending ? "Submitting…" : "Submit intake"}
          </button>
        </div>
      )}
    </form>
  );
}
