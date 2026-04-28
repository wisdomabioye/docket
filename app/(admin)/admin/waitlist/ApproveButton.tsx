"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";

export function ApproveButton(props: { entryId: string }): React.ReactElement {
  const router = useRouter();
  const approve = trpc.admin.approveWaitlistEntry.useMutation();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={approve.isPending || isPending}
      onClick={() =>
        approve.mutate(
          { entryId: props.entryId },
          { onSuccess: () => startTransition(() => router.refresh()) },
        )
      }
      className="rounded-md border border-[var(--color-ink)] px-3 py-1.5 text-xs disabled:opacity-50"
    >
      {approve.isPending ? "Approving…" : "Approve"}
    </button>
  );
}
