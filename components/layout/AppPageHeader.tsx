import type { ReactNode } from "react";

/**
 * Stage 00c attorney-area page header — eyebrow + serif title + optional
 * subtitle/description + right-aligned action slot. The admin area has
 * its own variant (`components/admin/PageHeader`) with breadcrumbs;
 * keep them separate so a stray attorney-page edit doesn't warp the
 * admin header chrome.
 *
 * Mockup: dashboard.html / case-overview.html / settings.html — they
 * all use this exact pattern (`text-xs uppercase tracking-[0.3em]`
 * eyebrow followed by serif title), inlined N times before this
 * extraction.
 */
export type AppPageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  /** Right-aligned action slot — typically a primary CTA link/button. */
  actions?: ReactNode;
};

export function AppPageHeader(
  props: AppPageHeaderProps,
): React.ReactElement {
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        {props.eyebrow ? (
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
            {props.eyebrow}
          </p>
        ) : null}
        <h1
          className="mt-2 text-3xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {props.title}
        </h1>
        {props.subtitle ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {props.subtitle}
          </p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
      ) : null}
    </header>
  );
}
