"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { trpc } from "@/lib/trpc/react";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  MAX_UPLOAD_BYTES,
  type DocumentType,
} from "@/lib/constants";

type Doc = {
  id: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  extractionStatus: string;
  extractionError: string | null;
  extractedAt: string | null;
  createdAt: string;
};

const ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
};

export function DocumentsPanel(props: {
  caseId: string;
  initialDocs: Doc[];
}): React.ReactElement {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>(props.initialDocs);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Document type chosen via the dropdown applies to the next batch of
  // dropped files. Defaults to "other" so attorneys can drag-and-go.
  const [documentType, setDocumentType] = useState<DocumentType>("other");

  const upload = trpc.document.upload.useMutation();
  const remove = trpc.document.delete.useMutation();

  const onDrop = useCallback(
    async (files: File[]) => {
      setError(null);
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(`${file.name}: exceeds 25 MB cap`);
          continue;
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        const b64 = bufferToBase64(buf);
        try {
          const result = await upload.mutateAsync({
            caseId: props.caseId,
            filename: file.name,
            mimeType:
              file.type as
                | "application/pdf"
                | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            documentType,
            contentBase64: b64,
          });
          setDocs((prev) => [
            {
              id: result.documentId,
              documentType,
              originalFilename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              extractionStatus: "completed",
              extractionError: null,
              extractedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        } catch (e) {
          setError(`${file.name}: ${(e as Error).message}`);
        }
      }
      startTransition(() => router.refresh());
    },
    [props.caseId, router, upload, documentType],
  );

  const dz = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: MAX_UPLOAD_BYTES,
    multiple: true,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label htmlFor="docType" className="text-sm">
          Document type
        </label>
        <select
          id="docType"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
          className="rounded-md border border-[var(--color-ink)] bg-white px-3 py-1.5 text-sm"
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOCUMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div
        {...dz.getRootProps()}
        className={`cursor-pointer rounded-md border-2 border-dashed p-8 text-center text-sm transition ${
          dz.isDragActive
            ? "border-[var(--color-ink)] bg-[var(--color-ink)]/5"
            : "border-[var(--color-ink)]/20"
        }`}
      >
        <input {...dz.getInputProps()} />
        {dz.isDragActive ? (
          <p>Drop files here…</p>
        ) : (
          <p>
            Drag PDF or DOCX files here, or{" "}
            <span className="underline">click to choose</span>.
          </p>
        )}
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Max 25 MB per file.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {docs.length === 0 ? (
        <p className="text-center text-sm text-[var(--color-ink-muted)]">
          No documents yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-ink)]/10">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-sm">{d.originalFilename}</p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {(d.sizeBytes / 1024).toFixed(0)} KB · {d.documentType} ·{" "}
                  <ExtractionPill status={d.extractionStatus} />
                  {d.extractionError && (
                    <span className="ml-1 text-red-600">
                      ({d.extractionError})
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await remove.mutateAsync({ documentId: d.id });
                  setDocs((prev) => prev.filter((x) => x.id !== d.id));
                  startTransition(() => router.refresh());
                }}
                className="text-xs text-[var(--color-ink-muted)] underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExtractionPill({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "text-green-700"
      : status === "failed"
        ? "text-red-700"
        : "text-amber-700";
  return <span className={color}>{status}</span>;
}

/**
 * Browser-safe base64 encoder for Uint8Array. Avoids the 65k arg limit
 * of `String.fromCharCode(...arr)` by chunking.
 */
function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}
