import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { safeCallbackUrl } from "@/server/auth/callback-url";
import { APP_INFO, APP_ROUTES } from "@/config";
import { env } from "@/config/env";
import { AuthShell } from "@/components/layout";
import { SsoButton } from "@/components/form";

/**
 * SSO-only sign-in page. Composed from `AuthShell` (centered card
 * skeleton) + `SsoButton` (server-action OAuth button). Both extracted
 * in Stage 00c so other auth-area pages (`/auth/error`, future
 * `/onboarding-pending`) share the same chrome.
 *
 * If the user is already signed in we bounce to /dashboard.
 *
 * Mockup: `Docket-Meridian-UI/hifi/login.html`.
 */

type Props = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const session = await auth();
  if (session?.user) redirect(APP_ROUTES.dashboard);

  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const noProvidersConfigured = !env.AUTH_GOOGLE_ID && !env.AUTH_MICROSOFT_ID;

  return (
    <AuthShell
      eyebrow="Sign in"
      title={APP_INFO.displayName}
      subtitle="Continue with your work account."
      footer={
        <>
          By continuing you agree to our{" "}
          <a href={APP_ROUTES.terms} className="underline">
            terms
          </a>{" "}
          and{" "}
          <a href={APP_ROUTES.privacy} className="underline">
            privacy policy
          </a>
          .
        </>
      }
    >
      {params.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {humanizeError(params.error)}
        </p>
      ) : null}

      <div className="space-y-3">
        {env.AUTH_GOOGLE_ID ? (
          <SsoButton
            provider="google"
            label="Continue with Google"
            callbackUrl={callbackUrl}
          />
        ) : null}
        {env.AUTH_MICROSOFT_ID ? (
          <SsoButton
            provider="microsoft-entra-id"
            label="Continue with Microsoft"
            callbackUrl={callbackUrl}
          />
        ) : null}
        {noProvidersConfigured ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            No SSO providers are configured. Set <code>AUTH_GOOGLE_ID</code>
            {" "}or <code>AUTH_MICROSOFT_ID</code> in <code>.env.local</code>.
          </p>
        ) : null}
      </div>
    </AuthShell>
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
