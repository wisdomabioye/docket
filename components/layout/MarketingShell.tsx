import type { ReactNode } from "react";
import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";

/**
 * Stage 11 marketing shell — wraps every public `(marketing)` route
 * (landing, pricing, terms, privacy, waitlist) with the same nav +
 * footer chrome. Used by `app/(marketing)/layout.tsx`.
 *
 * `<main>` is the direct child so per-page anchors and skip-links
 * land where readers expect.
 */
export function MarketingShell(props: {
  children: ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "var(--cream, #f5f1e8)" }}
    >
      <MarketingNav />
      <main className="flex-1">{props.children}</main>
      <MarketingFooter />
    </div>
  );
}
