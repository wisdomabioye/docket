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
};

/**
 * Client form: collects bar credentials + agreement filename + terms
 * acceptance, then calls `attorney.submitOnboarding` over tRPC. Stage 06
 * replaces the filename-only input with a real file upload.
 */
export function OnboardingForm(props: Props): React.ReactElement {
  const router = useRouter();
  const submit = trpc.attorney.submitOnboarding.useMutation();

  const [barNumber, setBarNumber] = useState(props.defaults.barNumber);
  const [barStatesInput, setBarStatesInput] = useState(
    props.defaults.barStates.join(", "),
  );
  const [agreementFilename, setAgreementFilename] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!termsAccepted || !agreementFilename || !barNumber) return;
    const barStates = barStatesInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    submit.mutate(
      {
        barNumber,
        barStates,
        // Always send the current literal — z.literal() at the boundary
        // would reject anything else.
        termsAcceptedVersion: TERMS_VERSION,
        agreementFilename,
      },
      {
        onSuccess: () => {
          startTransition(() => router.refresh());
        },
      },
    );
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

      <Field
        label="Signed contractor agreement"
        htmlFor="agreementFilename"
        hint="Upload by email for now — paste the filename. Real upload ships in Stage 06."
      >
        <input
          id="agreementFilename"
          required
          value={agreementFilename}
          onChange={(e) => setAgreementFilename(e.target.value)}
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2"
          placeholder="agreement-jane-doe.pdf"
        />
      </Field>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          required
          checked={termsAccepted}
          onChange={(e) => setTermsAccepted(e.target.checked)}
          className="mt-1"
        />
        <span>
          I have signed the contractor agreement and accept the{" "}
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
        disabled={submit.isPending || isPending}
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
