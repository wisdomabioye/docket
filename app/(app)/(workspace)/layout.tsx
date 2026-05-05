import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES } from "@/config";
import { getMe } from "@/lib/me-cache";
import {
  AppShell,
  AttorneySidebar,
  AttorneyTopbar,
  UserCard,
} from "@/components/layout";
import { PostHogIdentify } from "@/components/analytics/PostHogIdentify";

/**
 * Stage 11 attorney workspace shell. Wraps every route under the
 * `(workspace)` group (`/dashboard`, `/case/*`, `/settings`) with the
 * sidebar + topbar chrome.
 *
 * Excluded by design: `/onboarding` lives in `(app)` directly (no
 * `(workspace)` parent), so it keeps its own minimal centered layout
 * per `onboarding.html`.
 *
 * Auth + status routing happens here once instead of being repeated
 * on every page:
 *   - no session              → /login
 *   - no profile / pending    → page-level renders the appropriate
 *                                surface (PendingApprovalCard on
 *                                /dashboard); we still render the
 *                                shell so the sidebar context is
 *                                visible.
 *   - suspended / inactive    → /auth/error
 *
 * Pipeline counts pulled once at layout render and passed to the
 * sidebar; client-side `router.refresh()` after a case mutation
 * re-runs this layout so badges stay in sync without WebSocket.
 */
export default async function WorkspaceLayout(props: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const me = await getMe();
  if (!me) redirect(APP_ROUTES.authError + "?error=session-mismatch");

  const status = me.attorneyProfile?.status;
  if (status === "suspended" || status === "inactive") {
    redirect(APP_ROUTES.authError + `?error=${status}`);
  }

  // Pipeline counts: skip the query for users who don't have an active
  // profile yet (saves a useless round-trip; the sidebar still renders
  // with all-zero badges).
  const pipelineCounts =
    status === "active"
      ? await api.me.pipelineCounts()
      : { intake: 0, documents: 0, drafting: 0, review: 0, filed: 0 };

  return (
    <AppShell
      sidebar={
        <AttorneySidebar
          pipelineCounts={pipelineCounts}
          isAdmin={me.roles.includes("admin")}
          userCard={
            <UserCard
              name={me.user.name ?? me.user.email}
              email={me.user.email}
            />
          }
        />
      }
      topbar={<AttorneyTopbar />}
    >
      <PostHogIdentify userId={session.user.id} />
      {props.children}
    </AppShell>
  );
}
