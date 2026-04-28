import type { ReactNode } from "react";

/**
 * Page header chrome: breadcrumb, title, optional subtitle, optional
 * action slot (right-aligned). Used at the top of every admin page so
 * spacing and typography stay consistent.
 */

export function PageHeader(props: {
  breadcrumb: readonly string[];
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">{props.breadcrumb.join(" › ")}</p>
        <h1
          className="mt-2 text-2xl tracking-tight sm:text-[28px]"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
        >
          {props.title}
        </h1>
        {props.subtitle ? (
          <p className="mt-1.5 text-sm text-[var(--ink-muted)]">
            {props.subtitle}
          </p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {props.actions}
        </div>
      ) : null}
    </header>
  );
}
