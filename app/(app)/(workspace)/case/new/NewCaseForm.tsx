"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";
import {
  VISA_TYPES,
  isSupportedVisaType,
  type VisaType,
} from "@/lib/constants";

export function NewCaseForm(): React.ReactElement {
  const router = useRouter();
  const create = trpc.case.create.useMutation();
  const [visaType, setVisaType] = useState<VisaType>("O-1A");
  const supported = isSupportedVisaType(visaType);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!supported) return;
    create.mutate(
      { visaType },
      {
        onSuccess: ({ id }) => router.push(APP_ROUTES.caseIntake(id)),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="visaType" className="block text-sm font-medium">
          Visa type
        </label>
        <select
          id="visaType"
          value={visaType}
          onChange={(e) => setVisaType(e.target.value as VisaType)}
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2 text-sm"
        >
          {VISA_TYPES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {!supported && (
          <p
            role="status"
            className="text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            Support for {visaType} is in development. Only O-1A cases can be
            created today.
          </p>
        )}
      </div>

      {create.error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {create.error.message}
        </p>
      )}

      <button
        type="submit"
        disabled={create.isPending || !supported}
        className="rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-cream)] disabled:opacity-50"
      >
        {create.isPending ? "Creating…" : "Create case"}
      </button>
    </form>
  );
}
