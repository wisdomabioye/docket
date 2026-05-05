import Link from "next/link";
import { APP_ROUTES } from "@/config";
import {
  Sidebar,
  type SidebarSectionDef,
} from "@/components/layout/Sidebar";
import { UserCard } from "@/components/layout/UserCard";

/**
 * Admin-area sidebar — thin wrapper that supplies the admin nav
 * structure to the generic `Sidebar` primitive. Visual chrome,
 * desktop-vs-mobile drawer logic, and a11y plumbing all live in
 * `components/layout/Sidebar.tsx`; this file only owns the section
 * definitions, brand block, and the footer user card.
 *
 * Server component — Sidebar handles its own client surface.
 */

export type AdminSidebarProps = {
  /** Identity for the footer user card. Surfaces the same affordance
   *  as the attorney sidebar so admins can sign out without leaving
   *  the admin area. Optional only to support storybook / dev pages
   *  that render this without a session; production callers pass it. */
  user?: { name: string; email: string };
};

const SECTIONS: ReadonlyArray<SidebarSectionDef> = [
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
    items: [
      { label: "Audit log", href: APP_ROUTES.adminAuditLog, icon: "shield" },
    ],
  },
  {
    label: "Switch",
    items: [
      { label: "Attorney dashboard", href: APP_ROUTES.dashboard, icon: "home" },
    ],
  },
];

export function AdminSidebar(
  props: AdminSidebarProps = {},
): React.ReactElement {
  return (
    <Sidebar
      brand={<AdminBrand />}
      ariaLabel="Admin navigation"
      mobileMenuLabel="Open admin menu"
      sections={SECTIONS}
      footer={props.user ? <UserCard {...props.user} /> : undefined}
    />
  );
}

function AdminBrand(): React.ReactElement {
  return (
    <Link
      href={APP_ROUTES.admin}
      aria-label="Docket Admin — go to admin overview"
      className="flex items-center gap-2 text-[22px] tracking-[-0.01em]"
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
    </Link>
  );
}
