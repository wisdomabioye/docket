"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/react";
import { formatTrpcError } from "@/lib/trpc/format-error";

/**
 * Waitlist signup form. Calls `marketing.joinWaitlist` (publicProcedure).
 * Honeypot field `hp` is hidden via CSS — bots fill all fields, humans don't.
 *
 * UTM params from `?utm_source=...` are read on mount and forwarded.
 */
export function WaitlistForm(): React.ReactElement {
  const join = trpc.marketing.joinWaitlist.useMutation();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [hp, setHp] = useState(""); // honeypot

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!email) return;
    const utm = readUtm();
    join.mutate({
      kind: "general",
      email,
      name: name || undefined,
      source: "landing",
      hp: hp || undefined,
      ...utm,
    });
  }

  if (join.isSuccess) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-center text-sm text-green-800">
        {join.data.alreadyOnList
          ? "You're already on the list. We'll be in touch."
          : "You're on the list. We'll email you when we're ready."}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@firm.com"
        className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (optional)"
        className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-2.5 text-sm"
      />
      {/* Honeypot: hidden from humans via CSS + aria-hidden + tabIndex=-1. */}
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
        <p className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {formatTrpcError(join.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={join.isPending}
        className="w-full rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-cream)] disabled:opacity-50"
      >
        {join.isPending ? "Joining…" : "Join waitlist"}
      </button>
    </form>
  );
}

/**
 * Read `utm_*` query params off `window.location`. Returns at most 3
 * shorter-bounded values; the procedure further trims via Zod max.
 */
function readUtm(): {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
} {
  if (typeof window === "undefined") return {};
  const sp = new URL(window.location.href).searchParams;
  const out: Record<string, string | undefined> = {
    utmSource: clip(sp.get("utm_source")),
    utmMedium: clip(sp.get("utm_medium")),
    utmCampaign: clip(sp.get("utm_campaign")),
    referrer: clip(document.referrer),
  };
  // Strip undefined keys so zod's `.optional()` paths take cleanly.
  return Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined),
  );
}

function clip(s: string | null): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim().slice(0, 80);
  return trimmed || undefined;
}
