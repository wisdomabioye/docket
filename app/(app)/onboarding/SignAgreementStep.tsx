"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { formatTrpcError } from "@/lib/trpc/format-error";
// Type-only import — the source module is `import "server-only"`.
// `import type` is erased at compile time and never reaches the
// client bundle. A bare `import` would survive `isolatedModules:
// true` (TS keeps it) and trip the server-only sentinel at build
// time the moment any contributor uses these names as runtime values.
import type {
  CONTRACTOR_AGREEMENT_HASH,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";

type Props = {
  title: string;
  /** Pre-rendered, sanitized HTML for the agreement body. The server
   *  hashes the canonical markdown bytes and passes both the HTML and
   *  the corresponding hash literal here, so the user is shown a
   *  faithful presentation of the bytes they're about to sign. */
  bodyHtml: string;
  documentVersion: typeof CONTRACTOR_AGREEMENT_VERSION;
  contentHash: typeof CONTRACTOR_AGREEMENT_HASH;
};

/**
 * Step 1 of onboarding — read and e-sign the contractor agreement.
 * The Sign button stays disabled until:
 *   1. the reader has been scrolled to the bottom (or the body fits
 *      without scrolling — `checkBottom` runs on mount too);
 *   2. the typed full legal name has at least 2 trimmed characters;
 *   3. the ESIGN intent checkbox is checked.
 *
 * On success the page reloads (`router.refresh()`); the server then
 * renders Step 2 because `signature.getMyContractorSignature` now
 * returns a row.
 */
export function SignAgreementStep(props: Props): React.ReactElement {
  const router = useRouter();
  const sign = trpc.signature.signContractorAgreement.useMutation();

  const readerRef = useRef<HTMLDivElement | null>(null);
  const [hasReadToBottom, setHasReadToBottom] = useState(false);
  const [fullLegalName, setFullLegalName] = useState("");
  const [intent, setIntent] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Some viewports/agreements fit the container without scrolling —
    // require a scroll only when there's actually scrollable content.
    checkBottom();
  }, []);

  function checkBottom() {
    const el = readerRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 8) setHasReadToBottom(true);
  }

  const canSign =
    hasReadToBottom && fullLegalName.trim().length >= 2 && intent;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSign) return;
    sign.mutate(
      {
        documentVersion: props.documentVersion,
        contentHash: props.contentHash,
        fullLegalName: fullLegalName.trim(),
        intentAcknowledged: true,
      },
      {
        onSuccess: () => {
          startTransition(() => router.refresh());
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section
        aria-label={`${props.title} — body`}
        className="rounded-md border border-[var(--color-ink)] bg-white"
      >
        <header className="border-b border-[var(--color-ink)] px-4 py-2 text-xs uppercase tracking-[0.2em] text-[var(--color-ink-muted)]">
          {props.title} · {props.documentVersion}
        </header>
        <div
          ref={readerRef}
          onScroll={checkBottom}
          className="prose prose-sm max-w-none overflow-y-auto p-4 text-sm leading-relaxed"
          style={{ maxHeight: "28rem" }}
          // Sanitized server-side via `mdToSafeHtml` — Marked + sanitize-html
          // with the same allowlist Stage 08 outputs use.
          dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
        />
      </section>

      {!hasReadToBottom && (
        <p className="text-xs text-[var(--color-ink-muted)]">
          Scroll to the end of the agreement to enable the signature box.
        </p>
      )}

      <Field label="Full legal name (typed)" htmlFor="fullLegalName">
        <input
          id="fullLegalName"
          type="text"
          required
          autoComplete="name"
          value={fullLegalName}
          onChange={(e) => setFullLegalName(e.target.value)}
          className="w-full rounded-md border border-[var(--color-ink)] bg-white px-3 py-2"
          minLength={2}
          maxLength={120}
          placeholder="Jane Q. Doe"
        />
      </Field>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          required
          checked={intent}
          onChange={(e) => setIntent(e.target.checked)}
          className="mt-1"
        />
        <span>
          I intend my typed name above to be my electronic signature on this
          agreement, dated today.
        </span>
      </label>

      {sign.error && (
        <p className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formatTrpcError(sign.error)}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSign || sign.isPending}
        className="rounded-md border border-[var(--color-ink)] bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-cream)] disabled:opacity-50"
      >
        {sign.isPending ? "Signing…" : "Sign agreement"}
      </button>
    </form>
  );
}

function Field(props: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-1">
      <label htmlFor={props.htmlFor} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children}
    </div>
  );
}
