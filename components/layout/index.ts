/** Layout chrome — the shells and headers that wrap page content.
 *  Domain pages compose these instead of inlining `<main>`/`<header>`
 *  styling so a token tweak ripples through every page. */

export { AuthShell, type AuthShellProps } from "./AuthShell";
export { AppPageHeader, type AppPageHeaderProps } from "./AppPageHeader";
export { SignOutForm, type SignOutFormProps } from "./SignOutForm";
