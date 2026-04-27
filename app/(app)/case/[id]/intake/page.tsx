import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { IntakeForm } from "./IntakeForm";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Intake · ${id.slice(0, 8)}`) };
}

/**
 * Beneficiary intake form. Locked once status passes documents_pending
 * (the procedure rejects with CONFLICT in that case).
 */
export default async function IntakePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const data = await api.case.get({ caseId: id });
  if (!data) notFound();

  const locked = data.status !== "intake" && data.status !== "documents_pending";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Intake · {data.visaType}
        </p>
        <h1
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Beneficiary details
        </h1>
        {locked && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Read-only — beneficiary data is locked once status passes
            <code className="mx-1 font-mono">documents_pending</code>.
          </p>
        )}
      </header>

      <IntakeForm
        caseId={data.id}
        initial={
          (data.beneficiaryData as Record<string, string> | null) ?? {}
        }
        rowRevision={data.rowRevision}
        currentStatus={data.status}
        locked={locked}
      />
    </main>
  );
}
