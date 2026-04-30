import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES } from "@/config";
import { getMe } from "@/lib/me-cache";
import {
  AppShell,
  AttorneySidebar,
  AttorneyTopbar,
} from "@/components/layout";
import { SignOutForm } from "@/components/layout/SignOutForm";

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
      {props.children}
    </AppShell>
  );
}

function UserCard(props: {
  name: string;
  email: string;
}): React.ReactElement {
  const initials = props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex h-7 w-7 items-center justify-center rounded-sm text-[11px] font-medium"
        style={{
          background: "rgba(245,241,232,0.12)",
          color: "rgba(245,241,232,0.92)",
        }}
      >
        {initials || "·"}
      </span>
      <div className="min-w-0 flex-1 text-[12px] leading-tight">
        <p className="truncate font-medium" style={{ color: "var(--cream)" }}>
          {props.name}
        </p>
        <p
          className="truncate"
          style={{ color: "rgba(245,241,232,0.55)" }}
        >
          {props.email}
        </p>
      </div>
      <SignOutForm label="Out" />
    </div>
  );
}
