import type { ReactNode } from "react";
import { MarketingShell } from "@/components/layout";

/**
 * Stage 11 marketing layout — wraps every public route under
 * `(marketing)` (landing, pricing, terms, privacy, waitlist) with the
 * shared nav + footer chrome from `MarketingShell`. Per-page content
 * renders inside the shell's `<main>`.
 */
export default function MarketingGroupLayout(props: {
  children: ReactNode;
}): React.ReactElement {
  return <MarketingShell>{props.children}</MarketingShell>;
}
