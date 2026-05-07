"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/react";

/**
 * Attorney partnership application. Shares the `marketing.joinWaitlist`
 * mutation as the `attorney` discriminant — extra firm/bar fields land
 * in `waitlist_entries.details` (jsonb). Approval is the same one-click
 * admin action as a regular waitlist row; that row's `kind = "attorney"`
 * tells the admin which funnel it came from.
 */
export function AttorneyApplyForm(): React.ReactElement {
  const join = trpc.marketing.joinWaitlist.useMutation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [firmName, setFirmName] = useState("");
  const [stateOfAdmission, setStateOfAdmission] = useState("");
  const [barNumber, setBarNumber] = useState("");
  const [ailaMember, setAilaMember] = useState(false);
  const [yearsPracticing, setYearsPracticing] = useState("");
  const [notes, setNotes] = useState("");
  const [hp, setHp] = useState(""); // honeypot

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!email || !fullName || !firmName || !stateOfAdmission || !barNumber) {
      return;
    }
    const years = yearsPracticing.trim();
    join.mutate({
      kind: "attorney",
      email,
      name: fullName,
      source: "apply",
      hp: hp || undefined,
      details: {
        firmName,
        stateOfAdmission,
        barNumber,
        ailaMember,
        ...(years ? { yearsPracticing: Number(years) } : {}),
        ...(notes ? { notes } : {}),
      },
    });
  }

  if (join.isSuccess) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        {join.data.alreadyOnList
          ? "We already have an application from this email. We&rsquo;ll be in touch."
          : "Application received. We review within one business day and email you next steps."}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Full name" required>
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={120}
          suppressHydrationWarning
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
        />
      </Field>

      <Field label="Work email" required>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={320}
          suppressHydrationWarning
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
        />
      </Field>

      <Field label="Firm name" required>
        <input
          type="text"
          required
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          maxLength={200}
          suppressHydrationWarning
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="State of admission" required>
          <input
            type="text"
            required
            value={stateOfAdmission}
            onChange={(e) => setStateOfAdmission(e.target.value)}
            maxLength={80}
            placeholder="e.g. New York"
            suppressHydrationWarning
            className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
          />
        </Field>
        <Field label="Bar number" required>
          <input
            type="text"
            required
            value={barNumber}
            onChange={(e) => setBarNumber(e.target.value)}
            maxLength={80}
            suppressHydrationWarning
            className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Years practicing">
          <input
            type="number"
            min={0}
            max={80}
            value={yearsPracticing}
            onChange={(e) => setYearsPracticing(e.target.value)}
            suppressHydrationWarning
            className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={ailaMember}
            onChange={(e) => setAilaMember(e.target.checked)}
            suppressHydrationWarning
          />
          AILA member
        </label>
      </div>

      <Field label="Anything we should know? (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={3}
          suppressHydrationWarning
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
        />
      </Field>

      {/* Honeypot: hidden via off-screen position. Bots fill all fields. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        style={{ position: "absolute", left: "-10000px", width: "1px", height: "1px" }}
      />

      {join.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {join.error.message}
        </p>
      )}

      <button
        type="submit"
        disabled={join.isPending}
        className="w-full rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-cream)] disabled:opacity-50"
      >
        {join.isPending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}

function Field(props: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        {props.label}
        {props.required ? " *" : ""}
      </span>
      {props.children}
    </label>
  );
}
