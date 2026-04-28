import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/table";
import { ApproveButton } from "./ApproveButton";

export const metadata = { title: pageTitle("Waitlist") };

const COLUMNS: readonly Column[] = [
  { key: "email", label: "Email", mono: true },
  { key: "name", label: "Name", hideBelow: "sm" },
  { key: "source", label: "Source", hideBelow: "lg" },
  { key: "joined", label: "Joined", hideBelow: "md" },
  { key: "status", label: "Status" },
  { key: "actions", label: "", align: "right" },
];

/**
 * Waitlist + invite gate. Approving a row lets that email complete OAuth
 * sign-in. Rows stay listed even after approval so admins can audit who
 * approved whom and when.
 */
export default async function AdminWaitlistPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  let entries: Awaited<ReturnType<typeof api.admin.listWaitlist>>;
  try {
    entries = await api.admin.listWaitlist();
  } catch (err) {
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      redirect(APP_ROUTES.dashboard);
    }
    throw err;
  }

  const pendingCount = entries.filter((e) => !e.approvedAt).length;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Waitlist"]}
        title="Waitlist"
        subtitle={
          entries.length === 0
            ? "Nobody on the waitlist yet."
            : `${entries.length} total · ${pendingCount} awaiting approval`
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={entries}
        rowKey={(e) => e.id}
        empty={{
          title: "No waitlist entries yet.",
          subtitle:
            "Sign-ups from the landing page will appear here, awaiting approval.",
        }}
        renderCell={(e, col) => {
          switch (col.key) {
            case "email":
              return e.email;
            case "name":
              return e.name ?? "—";
            case "source":
              return (
                <span className="text-xs text-[var(--ink-muted)]">
                  {e.source ?? "—"}
                </span>
              );
            case "joined":
              return (
                <span className="mono text-xs text-[var(--ink-muted)]">
                  {new Date(e.createdAt).toLocaleDateString()}
                </span>
              );
            case "status":
              return e.approvedAt ? (
                <Badge variant="success">approved</Badge>
              ) : (
                <Badge variant="warning">pending</Badge>
              );
            case "actions":
              return e.approvedAt ? (
                <span className="mono text-[10px] text-[var(--ink-muted)]">
                  by {e.approvedByEmail ?? "—"}
                </span>
              ) : (
                <ApproveButton entryId={e.id} />
              );
            default:
              return null;
          }
        }}
      />
    </>
  );
}
