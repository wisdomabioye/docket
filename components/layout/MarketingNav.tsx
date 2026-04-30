import Link from "next/link";
import { APP_INFO, APP_ROUTES } from "@/config";

/**
 * Stage 11 marketing top nav. Mirrors `landing.html .mkt-nav`: brand
 * left, link cluster + sign-in CTA right. Sticky transparent → solid
 * on scroll handled via CSS backdrop-filter; no client JS so the nav
 * is RSC-safe and renders without hydration.
 *
 * Links pull from `APP_ROUTES` so a route rename ripples here once.
 */
export function MarketingNav(): React.ReactElement {
  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur supports-[backdrop-filter]:bg-[var(--cream)]/80"
      style={{
        borderColor: "var(--border, rgba(0,0,0,0.08))",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <Link
          href={APP_ROUTES.home}
          className="text-lg font-bold tracking-[-0.02em]"
        >
          {APP_INFO.name}
          <span style={{ color: "var(--accent, var(--ink))" }}>.</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm sm:flex">
          <Link
            href="#how"
            className="text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            How it works
          </Link>
          <Link
            href="#partnership"
            className="text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Partnership
          </Link>
          <Link
            href={APP_ROUTES.pricing}
            className="text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            Pricing
          </Link>
          <Link
            href="#faq"
            className="text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            FAQ
          </Link>
          <Link
            href={APP_ROUTES.login}
            className="rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--cream)] transition hover:opacity-90"
          >
            Sign in
          </Link>
        </nav>
        <Link
          href={APP_ROUTES.login}
          className="rounded-md border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--cream)] sm:hidden"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
