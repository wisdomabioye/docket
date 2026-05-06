import Link from "next/link";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { Badge, Card } from "@/components/ui";
import { attorneyStatusVariant } from "@/lib/status-style";
import { formatDate } from "@/lib/utils";
import { ActivateButton } from "../ActivateButton";
import { SuspendButton } from "../SuspendButton";
import { DownloadSignatureButton } from "./DownloadSignatureButton";

type Props = { params: Promise<{ userId: string }> };

export async function generateMetadata({ params }: Props) {
  const { userId } = await params;
  return { title: pageTitle(`Attorney · ${userId.slice(0, 8)}`) };
}

/**
 * Stage 09 attorney detail. Admin-only — auth + role gate already
 * enforced in `app/(admin)/layout.tsx`. Pulls full profile + recent
 * cases via `admin.getAttorney`.
 */
export default async function AttorneyDetailPage({ params }: Props) {
  const { userId } = await params;

  let data: Awaited<ReturnType<typeof api.admin.getAttorney>>;
  try {
    data = await api.admin.getAttorney({ userId });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "Attorneys", data.email]}
        title={data.name ?? data.email}
        subtitle={
          data.profile
            ? `Status: ${data.profile.status} · joined ${formatDate(data.joinedAt)}`
            : `No profile submitted · joined ${formatDate(data.joinedAt)}`
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          {data.profile ? (
            <dl className="space-y-2 text-sm">
              <Field label="Status">
                <Badge variant={attorneyStatusVariant[data.profile.status]}>
                  {data.profile.status}
                </Badge>
              </Field>
              <Field label="Email">
                <span className="mono">{data.email}</span>
              </Field>
              <Field label="Bar number">
                <span className="mono">{data.profile.barNumber ?? "—"}</span>
              </Field>
              <Field label="Bar states">
                <span className="mono">
                  {data.profile.barStates.length > 0
                    ? data.profile.barStates.join(", ")
                    : "—"}
                </span>
              </Field>
              <Field label="Submitted">
                <span className="mono">
                  {data.profile.submittedAt
                    ? formatDate(data.profile.submittedAt, { style: "full" })
                    : "—"}
                </span>
              </Field>
              <Field label="Contractor agreement">
                {data.contractorSignature ? (
                  <div className="space-y-1">
                    <div className="mono">
                      {formatDate(data.contractorSignature.signedAt, {
                        style: "full",
                      })}{" "}
                      · {data.contractorSignature.documentVersion}
                      {!data.contractorSignature.isCurrentVersion ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-900">
                          Outdated
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--ink-muted)]">
                      {data.contractorSignature.fullLegalName} (typed)
                    </div>
                    <div className="mono text-[10px] text-[var(--ink-muted)]">
                      sha256 {data.contractorSignature.contentHash.slice(0, 16)}…
                      {data.contractorSignature.ipAddress
                        ? ` · IP ${data.contractorSignature.ipAddress}`
                        : ""}
                    </div>
                    <DownloadSignatureButton id={data.contractorSignature.id} />
                  </div>
                ) : (
                  <span className="text-xs text-[var(--ink-muted)]">
                    Not signed yet
                  </span>
                )}
              </Field>
            </dl>
          ) : (
            <p className="text-sm text-[var(--ink-muted)]">
              This user has not submitted an attorney profile yet.
            </p>
          )}

          {data.profile ? (
            <div className="mt-4 flex gap-2 border-t pt-4">
              {data.profile.status === "pending" && data.profile.submittedAt ? (
                <ActivateButton userId={data.userId} />
              ) : null}
              {data.profile.status === "active" ? (
                <SuspendButton userId={data.userId} />
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card title={`Recent cases (${data.recentCases.length})`}>
          {data.recentCases.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">
              No cases yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.recentCases.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between border-b py-2 text-xs last:border-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <Link
                    href={APP_ROUTES.case(c.id)}
                    className="mono underline-offset-2 hover:underline"
                  >
                    {c.id.slice(0, 8)}
                  </Link>
                  <span className="mono">{c.visaType}</span>
                  <span className="capitalize">
                    {c.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-[var(--ink-muted)]">
                    {formatDate(c.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Link
          href={APP_ROUTES.adminAttorneys}
          className="text-xs underline"
          style={{ color: "var(--ink-soft)" }}
        >
          ← All attorneys
        </Link>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <dt className="text-[var(--ink-muted)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
