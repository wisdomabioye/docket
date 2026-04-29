/**
 * Stage 10 revenue split. Single source of truth for the 15/85
 * computation. All money math runs in cents (integer arithmetic) to
 * dodge floating-point rounding error.
 *
 * Spec §15: Docket takes 15%, attorney takes 85%. Floor on the docket
 * side — Docket loses fractions of a cent so the attorney is never
 * shorted. Documented as ADR-011 in `docs/decisions.md`. Phase 2 may
 * switch to banker's rounding once accounting agrees.
 *
 * The helper is pure (no IO, no env reads) so it lives outside
 * `index.ts` — easy to unit-test the math without spinning up the
 * Stripe SDK.
 */

export const DOCKET_SHARE_BPS = 1500; // 15% in basis points (0.15 * 10_000)
const BPS_DENOMINATOR = 10_000;

export type RevenueSplit = {
  /** Original fee in cents — non-negative integer. */
  feeCents: number;
  /** 15% rounded DOWN. Always ≤ `floor(feeCents * 0.15)`. */
  docketShareCents: number;
  /** Remainder; always equals `feeCents - docketShareCents`. */
  attorneyShareCents: number;
};

/**
 * Compute the 15/85 split for a case fee. Throws on negative or
 * non-finite input — those are caller bugs, not user-correctable
 * states. `0` is valid (pro-bono case) and yields `{0, 0, 0}`.
 */
export function computeRevenueSplit(feeCents: number): RevenueSplit {
  if (!Number.isFinite(feeCents) || !Number.isInteger(feeCents)) {
    throw new RangeError(
      `feeCents must be a finite integer; got ${feeCents}`,
    );
  }
  if (feeCents < 0) {
    throw new RangeError(`feeCents must be non-negative; got ${feeCents}`);
  }
  const docketShareCents = Math.floor((feeCents * DOCKET_SHARE_BPS) / BPS_DENOMINATOR);
  const attorneyShareCents = feeCents - docketShareCents;
  return { feeCents, docketShareCents, attorneyShareCents };
}

/**
 * Beneficiary-name masking for Stripe invoice line items. Spec §15.5
 * mandates initials only on the line description so the (PII-bearing)
 * full name doesn't leak through Stripe's customer email + dashboard.
 *
 * "Maria Gonzalez" → "M.G."
 * "Maria de la Cruz Gonzalez" → "M.D.L.C.G." (every word's initial)
 * Empty / whitespace → "Beneficiary" placeholder
 */
export function maskBeneficiaryName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (trimmed.length === 0) return "Beneficiary";
  const initials = trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .filter((c) => c.length > 0)
    .join(".");
  return initials.length > 0 ? `${initials}.` : "Beneficiary";
}

/**
 * Format an invoice line description: "{visaType} · Beneficiary {initials}".
 * Single source so the attorney-facing line + admin-side preview
 * agree on the wording.
 */
export function invoiceLineDescription(args: {
  visaType: string;
  beneficiaryFullName: string | null | undefined;
}): string {
  return `${args.visaType} · Beneficiary ${maskBeneficiaryName(args.beneficiaryFullName)}`;
}
