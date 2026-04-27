import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { api } from "@/lib/trpc/server";
import { APP_ROUTES, pageTitle } from "@/config";
import { DocumentsPanel } from "./DocumentsPanel";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: pageTitle(`Documents · ${id.slice(0, 8)}`) };
}

/**
 * Per-case documents tab. Drop-zone for upload + list of existing files
 * with extraction status pills.
 */
export default async function DocumentsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect(APP_ROUTES.login);

  const { id } = await params;
  const caseRow = await api.case.get({ caseId: id });
  if (!caseRow) notFound();

  const docs = await api.document.list({ caseId: id });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-ink-muted)]">
          Documents · {caseRow.visaType}
        </p>
        <h1
          className="mt-2 text-2xl tracking-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Evidence files
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          PDF and DOCX supported. Files are extracted on upload so the
          drafting AI can read them.
        </p>
      </header>

      <DocumentsPanel
        caseId={id}
        initialDocs={docs.map((d) => ({
          ...d,
          sizeBytes: Number(d.sizeBytes),
          createdAt: d.createdAt.toISOString(),
          extractedAt: d.extractedAt ? d.extractedAt.toISOString() : null,
        }))}
      />
    </main>
  );
}
