/** Layout chrome — the shells and headers that wrap page content.
 *  Domain pages compose these instead of inlining `<main>`/`<header>`
 *  styling so a token tweak ripples through every page. */

export { AttorneySidebar, type AttorneySidebarProps } from "./AttorneySidebar";
export { AttorneyTopbar } from "./AttorneyTopbar";
export { AuthShell, type AuthShellProps } from "./AuthShell";
export { AppPageHeader, type AppPageHeaderProps } from "./AppPageHeader";
export { AppShell, type AppShellProps } from "./AppShell";
export { Breadcrumbs, type BreadcrumbItem, type BreadcrumbsProps } from "./Breadcrumbs";
export { MarketingFooter } from "./MarketingFooter";
export { MarketingNav } from "./MarketingNav";
export { MarketingShell } from "./MarketingShell";
export {
  Sidebar,
  type SidebarNavItemDef,
  type SidebarProps,
  type SidebarSectionDef,
} from "./Sidebar";
export { SignOutForm, type SignOutFormProps } from "./SignOutForm";
export { Topbar, type TopbarProps } from "./Topbar";
export { UserCard, type UserCardProps } from "./UserCard";
