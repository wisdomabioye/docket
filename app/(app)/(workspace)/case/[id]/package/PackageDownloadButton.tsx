"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import { trpc } from "@/lib/trpc/react";

/**
 * Stage 08 package download button. Fires `output.downloadPackage`
 * which renders the bundle PDF + uploads it + returns a 10-min signed
 * URL. We open the URL in a new tab; the user keeps the package page
 * for re-download / re-review.
 *
 * Errors come back from the server with an attorney-readable `message`
 * (e.g. "Approve at least one output…") — surface verbatim. The
 * approved-zero case is also UI-prevented by the page hiding the
 * button entirely; the server check is defense in depth.
 */

export function PackageDownloadButton(props: {
  caseId: string;
  /** Server-driven gate from `case.preflight`. When true the button
   *  renders disabled with a tooltip — the page header surfaces the
   *  full reason; this prop just keeps the click suppressed. */
  disabled?: boolean;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const downloadMutation = trpc.output.downloadPackage.useMutation({
    onSuccess: ({ url }) => {
      setError(null);
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => setError(err.message),
  });

  const blocked = Boolean(props.disabled);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => downloadMutation.mutate({ caseId: props.caseId })}
        disabled={blocked || downloadMutation.isPending}
        title={blocked ? "Resolve pre-flight gates above before downloading." : undefined}
        className="rounded-sm border px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{
          borderColor: "var(--border-strong)",
          background: "var(--ink)",
        }}
      >
        {downloadMutation.isPending ? "Preparing PDF…" : "Download package"}
      </button>
      {error ? (
        <p
          role="alert"
          className="text-[11px]"
          style={{ color: "var(--danger, var(--ink-soft))" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
