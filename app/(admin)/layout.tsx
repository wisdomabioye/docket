import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import type { ReactNode } from "react";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { AdminSidebar } from "@/components/admin";
import { APP_ROUTES } from "@/config";

/**
 * Shared shell for `/admin/*`. Two-column layout: fixed sidebar +
 * scrolling main column.
 *
 * **Authorization happens here, not on every page.** We resolve the
 * session, then probe a cheap admin-only tRPC query — `is_admin()` SQL
 * check via `adminProcedure`. Non-admins bounce to the dashboard;
 * unauthenticated users to /login. Each page can assume the visitor is
 * an admin and skip its own role check.
 */
export default async function AdminLayout(props: {
  children: ReactNode;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  try {
    // Cheapest admin-only call we have — purely a permission probe.
    await api.admin.listPendingAttorneys();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  return (
    <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-[216px_1fr]">
      <AdminSidebar />
      <main className="min-w-0">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          {props.children}
        </div>
      </main>
    </div>
  );
}
