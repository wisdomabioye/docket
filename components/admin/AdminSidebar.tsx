"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_ROUTES } from "@/config";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * Navigation for `/admin/*`. Two presentations driven by viewport:
 *
 *   - **lg+**: fixed left rail, 216px, always visible.
 *   - **<lg**: top bar with a hamburger that opens a slide-over drawer.
 *
 * One component owns both modes so the nav definition (SECTIONS) doesn't
 * duplicate. Drawer state is local — closes on navigation, on Escape, and
 * on backdrop click. Body scroll-lock while open.
 *
 * Routes pull from `APP_ROUTES`; active highlight via `usePathname`.
 */

type NavItem = { label: string; href: string; icon: IconName };
type NavSection = { label: string; items: readonly NavItem[] };

const SECTIONS: readonly NavSection[] = [
  {
    label: "Operate",
    items: [
      { label: "Overview", href: APP_ROUTES.admin, icon: "layout-dashboard" },
      { label: "Attorneys", href: APP_ROUTES.adminAttorneys, icon: "users" },
      { label: "Waitlist", href: APP_ROUTES.adminWaitlist, icon: "clipboard-list" },
      { label: "Cases", href: APP_ROUTES.adminCases, icon: "file-text" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Revenue", href: APP_ROUTES.adminRevenue, icon: "dollar-sign" },
      { label: "Compute & models", href: APP_ROUTES.adminCompute, icon: "cpu" },
    ],
  },
  {
    label: "Compliance",
    items: [{ label: "Audit log", href: APP_ROUTES.adminAuditLog, icon: "shield" }],
  },
];

export function AdminSidebar(): React.ReactElement {
  const pathname = usePathname();
  // Track the pathname the drawer was opened for. The drawer is "open"
  // exactly when that pathname still matches — so a Link navigation
  // closes the drawer automatically (pathname changes → mismatch → closed).
  // Derived rather than effect-driven, which keeps `react-hooks/set-state-in-effect`
  // happy and avoids a flicker on route change.
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
      {/* Desktop rail */}
      <aside
        className="sticky top-0 hidden h-screen w-[216px] flex-col px-3 py-5 text-[var(--cream)] lg:flex"
        style={{ background: "var(--ink)" }}
      >
        <Brand />
        <Nav pathname={pathname} />
      </aside>

      {/* Mobile top bar */}
      <header
        className="sticky top-0 z-20 flex h-12 items-center justify-between px-3 text-[var(--cream)] lg:hidden"
        style={{ background: "var(--ink)" }}
      >
        <Brand compact />
        <button
          type="button"
          onClick={() => setOpenPath(pathname)}
          aria-label="Open admin menu"
          aria-expanded={open}
          className="rounded-sm p-2 text-[var(--cream)] hover:bg-[rgba(245,241,232,0.08)]"
        >
          <Icon name="menu" size={18} />
        </button>
      </header>

      {/* Mobile drawer */}
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
            aria-label="Admin navigation"
          >
            <div className="mb-4 flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => closeDrawer()}
                aria-label="Close menu"
                className="rounded-sm p-1.5 hover:bg-[rgba(245,241,232,0.08)]"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <Nav pathname={pathname} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 text-[20px] tracking-[-0.01em]",
        compact ? "" : "pb-4 text-[22px]",
      )}
      style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
    >
      Docket<span style={{ color: "var(--accent-ink)" }}>.</span>
      <span
        className="ml-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-[0.14em]"
        style={{
          background: "rgba(245,241,232,0.12)",
          color: "rgba(245,241,232,0.72)",
        }}
      >
        ADMIN
      </span>
    </div>
  );
}

function Nav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-1 flex-col overflow-y-auto">
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div
            className="px-2.5 pb-1.5 pt-3 text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "rgba(245,241,232,0.45)" }}
          >
            {section.label}
          </div>
          {section.items.map((item) => {
            const active =
              item.href === APP_ROUTES.admin
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "mb-px flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-[13px] font-medium transition",
                  active
                    ? "bg-[rgba(245,241,232,0.10)] text-[var(--cream)]"
                    : "text-[rgba(245,241,232,0.72)] hover:bg-[rgba(245,241,232,0.06)] hover:text-[var(--cream)]",
                )}
              >
                <Icon name={item.icon} size={14} className="opacity-80" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
