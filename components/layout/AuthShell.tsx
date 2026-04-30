import type { ReactNode } from "react";

/**
 * Stage 00c layout chrome — single-card centered layout used by every
 * (auth) route (`/login`, `/auth/error`, future `/onboarding-pending`).
 * Mirrors `Docket-Meridian-UI/hifi/login.html`'s `.auth-wrap` →
 * `.auth-center` → `.auth-card` skeleton, but compressed to the minimum
 * Phase 1 needs (no top brand bar, no foot strip — those land when the
 * mockup's header chrome ports across in Stage 11 polish).
 *
 * Composition: header (eyebrow + serif title + optional subtitle),
 * children (the form/card body), footer (terms/privacy microcopy or
 * "switch account" link). Each slot is optional; the shell only
 * renders the wrappers it has children for so empty slots don't leave
 * stray spacing.
 */
export type AuthShellProps = {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  /** Center-card body (forms, error notices, OAuth buttons). */
  children: ReactNode;
  /** Footer microcopy under the card (terms link, etc.). */
  footer?: ReactNode;
  /** Width cap for the centered card. Defaults to a tight `max-w-sm`
   *  per the mockup; widen to `max-w-md` for forms with more fields. */
  width?: "sm" | "md";
};

export function AuthShell(props: AuthShellProps): React.ReactElement {
  const widthClass = props.width === "md" ? "max-w-md" : "max-w-sm";
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div
        className={`w-full ${widthClass} space-y-8 text-center`}
        data-component="auth-shell"
      >
        <header>
          {props.eyebrow ? (
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
              {props.eyebrow}
            </p>
          ) : null}
          <h1
            className="mt-3 text-4xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {props.title}
          </h1>
          {props.subtitle ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              {props.subtitle}
            </p>
          ) : null}
        </header>
        {props.children}
        {props.footer ? (
          <p className="text-xs text-[var(--color-ink-muted)]">{props.footer}</p>
        ) : null}
      </div>
    </main>
  );
}
