"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";
import { TERMS_VERSION, type TermsVersion } from "@/server/auth/terms";

type Props = {
  defaults: {
    barNumber: string;
    barStates: readonly string[];
  };
  termsVersion: TermsVersion;
  signature: {
    id: string;
    /** ISO 8601 — server already serialized for transport. */
    signedAt: string;
    documentVersion: string;
  };
};

/**
 * Step 2 of onboarding — bar credentials + terms acceptance. The
 * contractor agreement was already signed in Step 1
 * (`SignAgreementStep`); we display a read-only summary with a link
 * to view the signed PDF, and pass `signature.id` through to the
 * onboarding submission.
 */
export function OnboardingForm(props: Props): React.ReactElement {
  const router = useRouter();
  const submit = trpc.attorney.submitOnboarding.useMutation();
  const downloadUrl = trpc.signature.getDownloadUrl.useMutation();

  const [barNumber, setBarNumber] = useState(props.defaults.barNumber);
  const [barStatesInput, setBarStatesInput] = useState(
    props.defaults.barStates.join(", "),
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!termsAccepted || !barNumber) return;
    const barStates = barStatesInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    submit.mutate(
      {
        barNumber,
        barStates,
        // Always send the current literal — z.literal() at the
        // boundary would reject anything else.
        termsAcceptedVersion: TERMS_VERSION,
        signatureId: props.signature.id,
      },
      {
        onSuccess: () => {
          startTransition(() => router.refresh());
        },
      },
    );
  }

  async function onView() {
    const result = await downloadUrl.mutateAsync({ id: props.signature.id });
    window.open(result.url, "_blank", "noopener");
  }

  if (submit.isSuccess) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        Submitted. We&rsquo;ll email you when an admin activates your account.{" "}
        <a href={APP_ROUTES.dashboard} className="underline">
          Back to dashboard
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Field label="Bar number" htmlFor="barNumber">
        <input
          id="barNumber"
          required
          value={barNumber}
          onChange={(e) => setBarNumber(e.target.value)}
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2"
          minLength={2}
        />
      </Field>

      <Field label="Bar states (comma-separated, e.g. NY, CA)" htmlFor="barStates">
        <input
          id="barStates"
          required
          value={barStatesInput}
          onChange={(e) => setBarStatesInput(e.target.value)}
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2 uppercase"
          placeholder="NY"
        />
      </Field>

      <div className="rounded-md border border-[var(--color-ink)] bg-[var(--color-cream)]/50 p-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-medium">Contractor agreement signed</div>
            <div className="text-xs text-[var(--color-ink-muted)]">
              {formatDate(props.signature.signedAt)} · {props.signature.documentVersion}
            </div>
          </div>
          <button
            type="button"
            onClick={onView}
            disabled={downloadUrl.isPending}
            className="text-xs underline disabled:opacity-50"
          >
            {downloadUrl.isPending ? "Opening…" : "View signed PDF"}
          </button>
        </div>
        {downloadUrl.error && (
          <p className="mt-2 text-xs text-red-700">{downloadUrl.error.message}</p>
        )}
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          required
          checked={termsAccepted}
          onChange={(e) => setTermsAccepted(e.target.checked)}
          className="mt-1"
        />
        <span>
          I accept the{" "}
          <a href={APP_ROUTES.terms} className="underline" target="_blank" rel="noreferrer">
            terms of service
          </a>{" "}
          ({props.termsVersion}).
        </span>
      </label>

      {submit.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {submit.error.message}
        </p>
      )}

      <button
        type="submit"
        disabled={submit.isPending}
        className="rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-cream)] disabled:opacity-50"
      >
        {submit.isPending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}

function Field(props: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.htmlFor} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children}
      {props.hint && (
        <p className="text-xs text-[var(--color-ink-muted)]">{props.hint}</p>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
