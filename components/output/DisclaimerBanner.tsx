import type { ReactElement } from "react";
import { DISCLAIMER } from "@/lib/computer/disclaimer";

/**
 * AI-disclaimer banner shown above every output's center column and on
 * the package page. Spec §17 + Stage 08 locked decision: the disclaimer
 * cannot be dismissed. Render it as a passive `<div role="note">` (not a
 * collapsible alert) so a screen reader announces it once per page-load
 * but doesn't block input.
 *
 * Single source of truth for the copy: `lib/computer/disclaimer.ts`. PDF
 * footer + system prompt + this UI banner all read from the same const.
 */
export function DisclaimerBanner(): ReactElement {
  return (
    <div
      role="note"
      aria-label="AI disclaimer"
      className="mx-10 my-3 flex items-start gap-2 rounded-sm border px-3 py-2 text-xs"
      style={{
        background: "var(--warning-soft)",
        borderColor: "var(--warning)",
        color: "var(--ink-soft)",
      }}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold"
        style={{
          borderColor: "var(--warning)",
          color: "var(--warning)",
          fontFamily: "var(--font-mono)",
        }}
      >
        i
      </span>
      <p className="leading-snug">
        <strong style={{ color: "var(--ink)" }}>AI-generated draft.</strong>{" "}
        {DISCLAIMER}
      </p>
    </div>
  );
}
