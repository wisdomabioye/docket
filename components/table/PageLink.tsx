import Link from "next/link";

/**
 * Single page-navigation link used by both the `DataTable` footer and
 * the audit-log custom footer (which renders a `<ul>` not a table). When
 * `href` is undefined the button renders disabled — matches the
 * keyset-pagination semantics where Prev on page-1 / Next on the last
 * page have no destination.
 */
export function PageLink(props: {
  href?: string;
  label: string;
}): React.ReactElement {
  if (!props.href) {
    return (
      <span
        className="cursor-not-allowed rounded-sm border px-2.5 py-1 opacity-40"
        style={{ borderColor: "var(--border)" }}
      >
        {props.label}
      </span>
    );
  }
  return (
    <Link
      href={props.href}
      className="rounded-sm border px-2.5 py-1 hover:bg-[var(--surface-sunken)]"
      style={{ borderColor: "var(--border)" }}
    >
      {props.label}
    </Link>
  );
}
