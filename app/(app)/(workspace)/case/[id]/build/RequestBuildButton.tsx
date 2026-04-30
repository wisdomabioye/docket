"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";

/**
 * Stage 11 build trigger. Calls `case.requestBuild` (Stage 7
 * mutation) and on success redirects to `/case/:id/outputs` so the
 * attorney lands on the live progress / draft list as the orchestrator
 * fans out.
 *
 * Server-side gating already ran (`case.readiness` returned `ok=true`
 * before this button rendered enabled), but we still surface the
 * server's error message inline if the mutation rejects — race-safe.
 */
export type RequestBuildButtonProps = {
  caseId: string;
  /** Disables the button when readiness gates are unmet. The tooltip
   *  surfaces why via the parent's reasons list. */
  disabled?: boolean;
};

export function RequestBuildButton(
  props: RequestBuildButtonProps,
): React.ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.case.requestBuild.useMutation({
    onSuccess: () => {
      router.push(APP_ROUTES.caseOutputs(props.caseId));
      router.refresh();
    },
    onError: (err) => setError(err.message),
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          mutation.mutate({ caseId: props.caseId });
        }}
        disabled={props.disabled || mutation.isPending}
        className="rounded-md border px-4 py-2 text-sm font-medium text-[var(--cream)] transition disabled:opacity-50"
        style={{
          borderColor: "var(--ink)",
          background: "var(--ink)",
        }}
      >
        {mutation.isPending ? "Building…" : "Build drafts →"}
      </button>
      {error ? (
        <p
          role="alert"
          className="text-xs"
          style={{ color: "var(--danger, #b1330e)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
