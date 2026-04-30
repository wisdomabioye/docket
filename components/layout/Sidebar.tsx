"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * Generic dark-rail sidebar used by both `(app)` and `(admin)` shells.
 * One component owns the desktop rail + mobile drawer + a11y plumbing
 * (escape close, scroll-lock, backdrop click, focus dialog) so per-area
 * sidebars only have to declare their nav structure.
 *
 * Per-area wrappers (AdminSidebar / AttorneySidebar) compose this with
 * their own `brand` slot, `sections` data, and optional `footer` (user
 * card pinned at the bottom of the rail).
 *
 * Why this exists: AdminSidebar inlined the rail + drawer + a11y once;
 * the attorney sidebar would have had to copy ~120 lines verbatim.
 * Generic primitive = single source of truth for the chrome; per-area
 * data lives at the call site.
 */

export type SidebarNavItemDef = {
  label: string;
  href: string;
  icon: IconName;
  /** Right-aligned count badge (e.g. pipeline counts). */
  count?: number;
};

export type SidebarSectionDef = {
  /** Section heading. Omit for the top "ungrouped" section. */
  label?: string;
  items: ReadonlyArray<SidebarNavItemDef>;
};

export type SidebarProps = {
  /** Brand/logo block rendered at the top of the rail (also at the top
   *  of the mobile drawer). */
  brand: ReactNode;
  /** ARIA label distinguishing this sidebar (e.g. "Admin navigation",
   *  "Attorney navigation"). Used on both the desktop `<aside>` and
   *  the mobile drawer's role="dialog". */
  ariaLabel: string;
  /** Mobile-bar label for the menu trigger button. */
  mobileMenuLabel?: string;
  sections: ReadonlyArray<SidebarSectionDef>;
  /** Bottom-pinned slot (user card, sign-out, etc.). */
  footer?: ReactNode;
};

export function Sidebar(props: SidebarProps): React.ReactElement {
  const pathname = usePathname();
  // Track the pathname the drawer was opened for. Drawer is "open"
  // exactly when that pathname still matches — so a Link navigation
  // closes the drawer automatically (pathname changes → mismatch →
  // closed). Avoids effect-driven state and prevents flicker.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath !== null && openPath === pathname;
  const closeDrawer = () => setOpenPath(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <aside
        className="sticky top-0 hidden h-screen w-[216px] flex-col px-3 py-5 text-[var(--cream)] lg:flex"
        style={{ background: "var(--ink)" }}
        aria-label={props.ariaLabel}
      >
        <div className="px-2.5">{props.brand}</div>
        <Nav sections={props.sections} pathname={pathname} />
        {props.footer ? (
          <div className="mt-auto px-2.5 pt-3">{props.footer}</div>
        ) : null}
      </aside>

      <header
        className="sticky top-0 z-20 flex h-12 items-center justify-between px-3 text-[var(--cream)] lg:hidden"
        style={{ background: "var(--ink)" }}
      >
        <div className="px-1">{props.brand}</div>
        <button
          type="button"
          onClick={() => setOpenPath(pathname)}
          aria-label={props.mobileMenuLabel ?? "Open menu"}
          aria-expanded={open}
          className="rounded-sm p-2 text-[var(--cream)] hover:bg-[rgba(245,241,232,0.08)]"
        >
          <Icon name="menu" size={18} />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => closeDrawer()}
            className="absolute inset-0 bg-black/40"
          />
          <aside
            className="absolute left-0 top-0 flex h-full w-[260px] flex-col px-3 py-5 text-[var(--cream)] shadow-xl"
            style={{ background: "var(--ink)" }}
            role="dialog"
            aria-modal="true"
            aria-label={props.ariaLabel}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="px-1">{props.brand}</div>
              <button
                type="button"
                onClick={() => closeDrawer()}
                aria-label="Close menu"
                className="rounded-sm p-1.5 hover:bg-[rgba(245,241,232,0.08)]"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <Nav sections={props.sections} pathname={pathname} />
            {props.footer ? (
              <div className="mt-auto pt-3">{props.footer}</div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}

function Nav({
  sections,
  pathname,
}: {
  sections: ReadonlyArray<SidebarSectionDef>;
  pathname: string;
}): React.ReactElement {
  return (
    <nav className="flex flex-1 flex-col overflow-y-auto">
      {sections.map((section, i) => (
        <div key={section.label ?? `__top-${i}`}>
          {section.label ? (
            <div
              className="px-2.5 pb-1.5 pt-3 text-[10px] font-medium uppercase tracking-[0.14em]"
              style={{ color: "rgba(245,241,232,0.45)" }}
            >
              {section.label}
            </div>
          ) : null}
          {section.items.map((item) => (
            <SidebarNavItem
              key={item.href}
              item={item}
              active={isActive(item.href, pathname)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Active-link rule: a top-level section root (e.g. "/admin", "/dashboard")
 * matches only on EXACT pathname; everything else uses prefix-match so
 * `/admin/attorneys/123` still highlights "Attorneys". Both AdminSidebar
 * and the attorney sidebar share this rule.
 */
function isActive(href: string, pathname: string): boolean {
  // Section-root paths are "/something" with one segment after "/".
  const segments = href.split("/").filter(Boolean);
  const isRootLevel = segments.length === 1;
  return isRootLevel ? pathname === href : pathname.startsWith(href);
}

function SidebarNavItem({
  item,
  active,
}: {
  item: SidebarNavItemDef;
  active: boolean;
}): React.ReactElement {
  return (
    <Link
      href={item.href}
      className={cn(
        "mb-px flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] font-medium transition",
        active
          ? "bg-[rgba(245,241,232,0.10)] text-[var(--cream)]"
          : "text-[rgba(245,241,232,0.72)] hover:bg-[rgba(245,241,232,0.06)] hover:text-[var(--cream)]",
      )}
    >
      <Icon name={item.icon} size={14} className="opacity-80" />
      <span className="flex-1">{item.label}</span>
      {typeof item.count === "number" && item.count > 0 ? (
        <span
          className="mono rounded-sm px-1.5 py-px text-[10px] tabular-nums"
          style={{
            background: "rgba(245,241,232,0.08)",
            color: "rgba(245,241,232,0.72)",
          }}
        >
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}
