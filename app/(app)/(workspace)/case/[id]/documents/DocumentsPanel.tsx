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
import { Badge } from "@/components/ui";
import { formatMb, formatRelative } from "@/lib/utils";
import { extractionBadge, fileExtLabel } from "@/lib/document-display";

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
      const now = new Date().toISOString();
      // Insert a row for EVERY dropped file up front so the attorney sees
      // instant feedback ("Uploading…"). Oversize files land as "failed"
      // immediately; valid ones flip to the real extraction status (or
      // "OCR failed") as each upload resolves.
      const queued = files.map((file) => ({
        file,
        tempId: `tmp-${crypto.randomUUID()}`,
        oversize: file.size > MAX_UPLOAD_BYTES,
      }));
      setDocs((prev) => [
        ...queued.map(({ file, tempId, oversize }) => ({
          id: tempId,
          documentType,
          originalFilename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          extractionStatus: oversize ? "failed" : "uploading",
          extractionError: oversize ? "Exceeds 25 MB cap" : null,
          extractedAt: null,
          createdAt: now,
        })),
        ...prev,
      ]);

      for (const { file, tempId, oversize } of queued) {
        if (oversize) {
          setError(`${file.name}: exceeds 25 MB cap`);
          continue;
        }
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          const b64 = bufferToBase64(buf);
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
          // Swap the temp row for the real one — real id + the actual
          // extraction outcome the server just computed (no assuming
          // "completed").
          setDocs((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? {
                    ...d,
                    id: result.documentId,
                    extractionStatus: result.extractionStatus,
                    extractionError: result.extractionError,
                    extractedAt: now,
                  }
                : d,
            ),
          );
        } catch (e) {
          const message = (e as Error).message;
          setError(`${file.name}: ${message}`);
          setDocs((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? { ...d, extractionStatus: "failed", extractionError: message }
                : d,
            ),
          );
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

  // The dropzone copy reflects the selected document type so it's clear
  // what the next drop will be filed as ("Drag your CV / résumé here").
  // "Other" stays generic since "your Other" reads oddly.
  const dropTarget =
    documentType === "other"
      ? "a document"
      : `your ${DOCUMENT_TYPE_LABELS[documentType]}`;

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
        <span
          aria-hidden="true"
          className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full text-base"
          style={{
            background: "var(--accent-soft, rgba(0,0,0,0.05))",
            color: "var(--accent, var(--ink))",
          }}
        >
          ↑
        </span>
        {dz.isDragActive ? (
          <p>Drop {dropTarget} here…</p>
        ) : (
          <p>
            Drag {dropTarget} here, or{" "}
            <span className="underline">click to choose</span>.
          </p>
        )}
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          PDF or DOCX · Max 25 MB per file.
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
        <>
          <p className="text-xs text-[var(--color-ink-muted)]">
            All documents · {docs.length}{" "}
            {docs.length === 1 ? "file" : "files"} ·{" "}
            {formatMb(docs.reduce((sum, d) => sum + d.sizeBytes, 0))} MB
          </p>
          <ul className="divide-y divide-[var(--color-ink)]/10">
            {docs.map((d) => {
              const badge = extractionBadge(d.extractionStatus);
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mono mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border text-[9px] font-medium"
                      style={{
                        borderColor: "var(--border, rgba(0,0,0,0.15))",
                        color: "var(--ink-muted)",
                      }}
                    >
                      {fileExtLabel(d.originalFilename)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{d.originalFilename}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                        <span>
                          {DOCUMENT_TYPE_LABELS[
                            d.documentType as DocumentType
                          ] ?? d.documentType}
                        </span>
                        <span>· {(d.sizeBytes / 1024).toFixed(0)} KB</span>
                        <span suppressHydrationWarning>
                          · {formatRelative(d.createdAt)}
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {d.extractionError ? (
                          <span style={{ color: "var(--error, #b91c1c)" }}>
                            ({d.extractionError})
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  {d.extractionStatus === "uploading" ? null : (
                    <button
                      type="button"
                      onClick={async () => {
                        await remove.mutateAsync({ documentId: d.id });
                        setDocs((prev) => prev.filter((x) => x.id !== d.id));
                        startTransition(() => router.refresh());
                      }}
                      className="shrink-0 text-xs text-[var(--color-ink-muted)] underline"
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
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
