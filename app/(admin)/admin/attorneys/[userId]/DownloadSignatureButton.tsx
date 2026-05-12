"use client";

import { trpc } from "@/lib/trpc/react";
import { formatTrpcError } from "@/lib/trpc/format-error";

/**
 * Admin-only button that mints a fresh 5-minute signed URL for the
 * attorney's signed contractor-agreement PDF and opens it in a new
 * tab. Server-side authorization (`signature.getDownloadUrl`)
 * accepts both owner and admin callers.
 */
export function DownloadSignatureButton({
  id,
}: {
  id: string;
}): React.ReactElement {
  const downloadUrl = trpc.signature.getDownloadUrl.useMutation();

  async function onClick() {
    const result = await downloadUrl.mutateAsync({ id });
    window.open(result.url, "_blank", "noopener");
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={downloadUrl.isPending}
        className="text-xs underline disabled:opacity-50"
      >
        {downloadUrl.isPending ? "Opening…" : "Download signed PDF"}
      </button>
      {downloadUrl.error && (
        <p className="mt-1 whitespace-pre-line text-xs text-red-700">
          {formatTrpcError(downloadUrl.error)}
        </p>
      )}
    </div>
  );
}
