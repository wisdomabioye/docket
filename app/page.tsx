import { APP_INFO, APP_ROUTES } from "@/config";
import { WaitlistForm } from "./WaitlistForm";

/**
 * Phase 1 landing page. Functional minimum: brand hero + value prop +
 * waitlist form. Stage 00b/00c design system polishes typography and
 * component primitives; the full mockup at
 * `Docket-Meridian-UI/hifi/landing.html` is the visual target.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 space-y-16">
      <section className="text-center space-y-6">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Beta · invite-only
        </p>
        <h1
          className="text-6xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {APP_INFO.displayName}
        </h1>
        <p className="mx-auto max-w-xl text-lg leading-relaxed text-[var(--color-ink-muted)]">
          {APP_INFO.tagline}
        </p>
      </section>

      <section className="mx-auto max-w-md space-y-4">
        <h2
          className="text-center text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Join the waitlist
        </h2>
        <p className="text-center text-sm text-[var(--color-ink-muted)]">
          Solo immigration attorneys only, for now. We&rsquo;ll reach out as
          spots open up.
        </p>
        <WaitlistForm />
      </section>

      <footer className="pt-12 border-t border-[var(--color-ink)]/10 text-center text-xs text-[var(--color-ink-muted)]">
        <p>
          Already have an account?{" "}
          <a href={APP_ROUTES.login} className="underline">
            Sign in
          </a>
        </p>
        <p className="mt-2">
          <a href={APP_ROUTES.terms} className="underline">
            Terms
          </a>{" "}
          ·{" "}
          <a href={APP_ROUTES.privacy} className="underline">
            Privacy
          </a>
        </p>
        <p className="mt-4">
          © {new Date().getFullYear()} {APP_INFO.name}
        </p>
      </footer>
    </main>
  );
}
