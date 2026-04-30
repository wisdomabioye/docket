import Link from "next/link";
import { APP_INFO, APP_ROUTES, pageTitle } from "@/config";

export const metadata = { title: pageTitle("Not found") };

/**
 * Stage 11 branded 404. Plain centered layout — no MarketingShell so
 * a 404 from inside the workspace doesn't drag in the marketing nav.
 */
export default function NotFound(): React.ReactElement {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-6"
      style={{ background: "var(--cream, #f5f1e8)" }}
    >
      <div className="max-w-md text-center">
        <p
          className="text-xs uppercase tracking-[0.3em]"
          style={{ color: "var(--ink-muted)" }}
        >
          404
        </p>
        <h1
          className="mt-4 text-5xl tracking-tight"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
        >
          {APP_INFO.name}
          <span style={{ color: "var(--accent, var(--ink))" }}>.</span>
        </h1>
        <p className="mt-4 text-base" style={{ color: "var(--ink-soft)" }}>
          That page isn&rsquo;t here. Maybe one of these does what you wanted.
        </p>
        <ul className="mt-6 space-y-2 text-sm">
          <li>
            <Link
              href={APP_ROUTES.home}
              className="underline-offset-2 hover:underline"
            >
              Back to the landing page →
            </Link>
          </li>
          <li>
            <Link
              href={APP_ROUTES.login}
              className="underline-offset-2 hover:underline"
            >
              Sign in →
            </Link>
          </li>
          <li>
            <Link
              href={APP_ROUTES.pricing}
              className="underline-offset-2 hover:underline"
            >
              Pricing →
            </Link>
          </li>
        </ul>
      </div>
    </main>
  );
}
