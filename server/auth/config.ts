import "server-only";
import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db/client";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/server/db/schema";
import { onSignIn } from "./onboarding";
import { isInvitePermitted } from "./invite-gate";
import { APP_ROUTES } from "@/config";
import { env } from "@/config/env";
import { emitFromUser } from "@/server/services/analytics/emit";

/**
 * Auth.js v5 — SSO only (Google, Microsoft). Sessions persist in our own
 * Postgres via the Drizzle adapter (no JWTs). Apple is deferred to Stage 11.
 *
 * On first successful sign-in, `onSignIn()` provisions the user's
 * organization, membership, role, and attorney profile in one transaction.
 *
 * Why named-table mapping: our schema uses snake_case columns whereas
 * Auth.js's adapter expects specific camelCase property names. Drizzle's
 * column declarations match the adapter's contract (e.g. `emailVerified`).
 */

const providers = [
  ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
    ? [
        Google({
          clientId: env.AUTH_GOOGLE_ID,
          clientSecret: env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : []),
  ...(env.AUTH_MICROSOFT_ID && env.AUTH_MICROSOFT_SECRET
    ? [
        MicrosoftEntraID({
          clientId: env.AUTH_MICROSOFT_ID,
          clientSecret: env.AUTH_MICROSOFT_SECRET,
          // `common` lets both work + personal Microsoft accounts sign in.
          issuer: "https://login.microsoftonline.com/common/v2.0",
        }),
      ]
    : []),
];

// The adapter's table types don't satisfy our schema's stricter
// `exactOptionalPropertyTypes: true` shape. The runtime contract (column
// names + types) is correct; this is purely a TS-strictness mismatch.
// Cast the result, not the args, so the call signature stays normal.
const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
} as never);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers,
  session: { strategy: "database" },
  pages: {
    signIn: APP_ROUTES.login,
    error: APP_ROUTES.authError,
  },
  callbacks: {
    /**
     * Invite gate. Runs BEFORE the adapter creates the user row, so
     * rejected sign-ins leave no trace in the DB. Returning a string
     * redirects to that URL; we surface a friendly `not-invited` code on
     * the auth error page. Returning `true` lets the sign-in proceed.
     *
     * Returning users (already in `users`) always pass — the gate only
     * applies to first-time sign-ups.
     */
    signIn: async ({ user, profile }) => {
      const email = user.email ?? profile?.email;
      if (!email) return false;
      const allowed = await isInvitePermitted(email);
      if (allowed) return true;
      return `${APP_ROUTES.authError}?error=not-invited`;
    },
  },
  events: {
    signIn: async ({ user, account, isNewUser }) => {
      if (!user.id) return;
      await onSignIn({ userId: user.id, isNewUser: Boolean(isNewUser) });
      // Best-effort analytics emit. `account?.provider` is the
      // Auth.js provider id (`google`, `microsoft-entra-id`, `apple`).
      // Map to the short event-payload union; any unrecognised value
      // skips the emit rather than guessing.
      const provider = mapProvider(account?.provider);
      if (provider) {
        void emitFromUser(user.id, {
          name: "auth.signed_in",
          properties: { provider, is_new_user: Boolean(isNewUser) },
        });
      }
    },
  },
  trustHost: true,
});

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

/** Translate the Auth.js `account.provider` id into the short union
 *  declared on the `auth.signed_in` analytics event. Apple is wired in
 *  the providers list (deferred per Stage 11 plan), but the case is
 *  here so when it ships we don't need to remember to update analytics
 *  too. Returns null for unrecognised providers — better to skip an
 *  emit than to send an unknown enum value. */
function mapProvider(
  providerId: string | undefined,
): "google" | "microsoft" | "apple" | null {
  switch (providerId) {
    case "google":
      return "google";
    case "microsoft-entra-id":
      return "microsoft";
    case "apple":
      return "apple";
    default:
      return null;
  }
}
