import Link from "next/link";

/**
 * Stage 11 breadcrumbs primitive used by Topbar (and admin's PageHeader
 * eventually). Last item is rendered text-only (no link); preceding
 * items are anchors. Separator is `›` per mockup app.css `.crumbs`.
 *
 * Pure server component. The shape `{ label, href? }` is the same one
 * the admin PageHeader's breadcrumb prop accepts so the two stay
 * compatible — Stage 11 polish step will fold admin's inline breadcrumb
 * into this primitive.
 */
export type BreadcrumbItem = {
  label: string;
  /** Omit `href` to render as the current/leaf item (text-only). */
  href?: string;
};

export type BreadcrumbsProps = {
  items: ReadonlyArray<BreadcrumbItem>;
};

export function Breadcrumbs(props: BreadcrumbsProps): React.ReactElement {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-xs"
      style={{ color: "var(--ink-muted)" }}
    >
      {props.items.map((item, idx) => {
        const isLast = idx === props.items.length - 1;
        return (
          <span key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
            {idx > 0 ? (
              <span aria-hidden="true" className="opacity-60">
                ›
              </span>
            ) : null}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="underline-offset-2 hover:text-[var(--ink)] hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                style={isLast ? { color: "var(--ink)" } : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
