import { APP_INFO } from "@/config";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Beta
        </p>
        <h1
          className="mt-4 text-6xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {APP_INFO.displayName}
        </h1>
        <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--color-ink-muted)]">
          {APP_INFO.tagline}
        </p>
      </div>
    </main>
  );
}
