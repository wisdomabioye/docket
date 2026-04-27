"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";

export function ActivateButton(props: { userId: string }): React.ReactElement {
  const router = useRouter();
  const activate = trpc.admin.activateAttorney.useMutation();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={activate.isPending || isPending}
      onClick={() =>
        activate.mutate(
          { userId: props.userId },
          { onSuccess: () => startTransition(() => router.refresh()) },
        )
      }
      className="rounded-md border border-[var(--color-ink)] px-3 py-1.5 text-xs disabled:opacity-50"
    >
      {activate.isPending ? "Activating…" : "Activate"}
    </button>
  );
}
