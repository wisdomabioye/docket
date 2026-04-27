import { redirect } from "next/navigation";
import { auth, signIn } from "@/server/auth/config";
import { APP_INFO, APP_ROUTES } from "@/config";
import { env } from "@/config/env";

/**
 * SSO-only sign-in page. Provider buttons are server-rendered + use a
 * server-action signIn — no client JS required.
 *
 * If the user is already signed in we bounce to /dashboard.
 *
 * Mockup: `Docket-Meridian-UI/hifi/login.html` — Stage 00b/c will replace
 * this with the polished primitive layout. Stage 02 ships the functional
 * minimum.
 */

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  if (session?.user) redirect(APP_ROUTES.dashboard);

  const params = await searchParams;
  // Same-origin only — block open-redirect via `?callbackUrl=https://evil.com`.
  // Must start with `/`, must not start with `//` (protocol-relative URL).
  const requested = params.callbackUrl ?? "";
  const callbackUrl =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : APP_ROUTES.dashboard;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8 text-center">
        <header>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
            Sign in
          </p>
          <h1
            className="mt-3 text-4xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {APP_INFO.displayName}
          </h1>
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            Continue with your work account.
          </p>
        </header>

        {params.error && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {humanizeError(params.error)}
          </p>
        )}

        <div className="space-y-3">
          {env.AUTH_GOOGLE_ID && (
            <ProviderButton
              provider="google"
              label="Continue with Google"
              callbackUrl={callbackUrl}
            />
          )}
          {env.AUTH_MICROSOFT_ID && (
            <ProviderButton
              provider="microsoft-entra-id"
              label="Continue with Microsoft"
              callbackUrl={callbackUrl}
            />
          )}
          {!env.AUTH_GOOGLE_ID && !env.AUTH_MICROSOFT_ID && (
            <p className="text-sm text-[var(--color-ink-muted)]">
              No SSO providers are configured. Set <code>AUTH_GOOGLE_ID</code>
              or <code>AUTH_MICROSOFT_ID</code> in <code>.env.local</code>.
            </p>
          )}
        </div>

        <p className="text-xs text-[var(--color-ink-muted)]">
          By continuing you agree to our{" "}
          <a href={APP_ROUTES.terms} className="underline">
            terms
          </a>{" "}
          and{" "}
          <a href={APP_ROUTES.privacy} className="underline">
            privacy policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}

function ProviderButton(props: {
  provider: string;
  label: string;
  callbackUrl: string;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(props.provider, { redirectTo: props.callbackUrl });
      }}
    >
      <button
        type="submit"
        className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-ink)] hover:text-[var(--color-cream)]"
      >
        {props.label}
      </button>
    </form>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case "OAuthAccountNotLinked":
      return "That email is already linked to a different sign-in method.";
    case "AccessDenied":
      return "Access denied. Please contact your administrator.";
    case "Configuration":
      return "Sign-in is misconfigured. Contact support.";
    default:
      return "Something went wrong signing you in. Please try again.";
  }
}
