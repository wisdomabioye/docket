import Link from "next/link";
import { APP_ROUTES } from "@/config";

/**
 * Stage 03 dashboard inline card shown to attorneys whose
 * `attorney_profiles.status === 'pending'`. Per spec §12.3 and
 * `build_stages/03_attorney_onboarding.md` Step 4, the dashboard
 * RENDERS this card for pending users — it does NOT redirect them to
 * `/onboarding`. The onboarding form is a one-time pre-status flow;
 * once submitted, the attorney lands on `/dashboard` and waits here
 * until an admin activates them.
 *
 * Brand voice: matter-of-fact, no emojis, no exclamation points. The
 * "usually within one business day" claim mirrors the spec; if SLAs
 * change, edit this file.
 *
 * Server component — no client state. The "Edit application" link
 * deep-links back to the onboarding form so a pending attorney can
 * still amend bar-credentials etc. (the form re-loads existing values
 * from the profile row).
 */
export type PendingApprovalCardProps = {
  /** Attorney's email — shown in the "we'll notify" line so the user
   *  recognises the destination address. Optional; omitted gracefully. */
  email?: string | null;
  /** ISO timestamp of the original submission — formatted as a short
   *  human date. Optional; omitted when undefined. */
  submittedAt?: Date | string | null;
};

export function PendingApprovalCard(
  props: PendingApprovalCardProps,
): React.ReactElement {
  const submittedLabel = formatSubmittedAt(props.submittedAt);
  return (
    <section
      aria-label="Account pending approval"
      data-component="pending-approval-card"
      className="rounded-md border p-6"
      style={{
        borderColor: "var(--accent, var(--color-ink))",
        background: "var(--accent-soft, var(--surface-sunken, #f5f1e9))",
      }}
    >
      <p
        className="text-xs uppercase tracking-[0.3em]"
        style={{ color: "var(--color-ink-muted)" }}
      >
        Pending approval
      </p>
      <h2
        className="mt-2 text-2xl tracking-tight"
        style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      >
        Your Docket account is pending approval.
      </h2>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--color-ink-soft, var(--color-ink))" }}
      >
        We&rsquo;ll email you{props.email ? <> at <b>{props.email}</b></> : null}{" "}
        when an admin activates your account. Approvals usually land within one
        business day.
      </p>
      {submittedLabel ? (
        <p
          className="mt-3 text-xs"
          style={{ color: "var(--color-ink-muted)" }}
        >
          Submitted {submittedLabel}.
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-4 text-xs">
        <Link
          href={APP_ROUTES.onboarding}
          className="underline-offset-2 hover:underline"
        >
          Edit application →
        </Link>
      </div>
    </section>
  );
}

function formatSubmittedAt(input: Date | string | null | undefined): string | null {
  if (!input) return null;
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
