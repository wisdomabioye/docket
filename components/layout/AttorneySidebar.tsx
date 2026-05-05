import Link from "next/link";
import { APP_ROUTES } from "@/config";
import {
  Sidebar,
  type SidebarSectionDef,
} from "@/components/layout/Sidebar";

/**
 * Attorney-area sidebar. Composes the generic `Sidebar` primitive
 * with the attorney nav structure pulled from `dashboard.html`'s
 * `nav.side` block.
 *
 * Pipeline counts are passed in from the layout (one tRPC round-trip
 * shared across the whole `(workspace)` subtree). Counts of 0 hide
 * the badge per Sidebar primitive's contract.
 */

export type AttorneySidebarProps = {
  pipelineCounts: {
    intake: number;
    documents: number;
    drafting: number;
    review: number;
    filed: number;
  };
  /** When true, append a "Switch" section with an Admin console link.
   *  Driven by `me.roles.includes("admin")` — see workspace layout. */
  isAdmin?: boolean;
  /** Footer slot — typically the user card. Optional. */
  userCard?: React.ReactNode;
};

export function AttorneySidebar(
  props: AttorneySidebarProps,
): React.ReactElement {
  const sections: ReadonlyArray<SidebarSectionDef> = [
    {
      items: [
        {
          label: "Dashboard",
          href: APP_ROUTES.dashboard,
          icon: "layout-dashboard",
        },
        {
          label: "New case",
          href: APP_ROUTES.newCase,
          icon: "file-text",
        },
      ],
    },
    {
      label: "Pipeline",
      items: [
        {
          label: "Intake",
          href: `${APP_ROUTES.dashboard}?stage=intake`,
          icon: "clipboard-list",
          count: props.pipelineCounts.intake,
        },
        {
          label: "Documents",
          href: `${APP_ROUTES.dashboard}?stage=documents`,
          icon: "file-text",
          count: props.pipelineCounts.documents,
        },
        {
          label: "Drafting",
          href: `${APP_ROUTES.dashboard}?stage=drafting`,
          icon: "cpu",
          count: props.pipelineCounts.drafting,
        },
        {
          label: "Review",
          href: `${APP_ROUTES.dashboard}?stage=review`,
          icon: "check",
          count: props.pipelineCounts.review,
        },
        {
          label: "Filed",
          href: `${APP_ROUTES.dashboard}?stage=filed`,
          icon: "shield",
          count: props.pipelineCounts.filed,
        },
      ],
    },
    {
      label: "Workspace",
      items: [
        {
          label: "Settings",
          href: APP_ROUTES.settings,
          icon: "settings",
        },
      ],
    },
    ...(props.isAdmin
      ? [
          {
            label: "Switch",
            items: [
              {
                label: "Admin console",
                href: APP_ROUTES.admin,
                icon: "shield" as const,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <Sidebar
      brand={<AttorneyBrand />}
      ariaLabel="Attorney navigation"
      mobileMenuLabel="Open navigation"
      sections={sections}
      footer={props.userCard}
    />
  );
}

function AttorneyBrand(): React.ReactElement {
  return (
    <Link
      href={APP_ROUTES.dashboard}
      aria-label="Docket — go to dashboard"
      className="flex items-center gap-1 text-[22px] tracking-[-0.01em]"
      style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
    >
      Docket
      <span style={{ color: "var(--accent-ink, var(--accent))" }}>.</span>
    </Link>
  );
}
