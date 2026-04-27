import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, type Db } from "@/server/db/client";
import { caseDocuments, caseEvents } from "@/server/db/schema";
import { documentKey, storage } from "@/server/services/storage";
import { extract } from "@/server/services/extraction";
import { AppError } from "@/lib/errors";
import { DOCUMENT_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

/** Re-exported so router/tests don't need a separate import path. */
export const MAX_FILE_BYTES = MAX_UPLOAD_BYTES;
export { DOCUMENT_TYPES };

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "image/jpeg",
  "image/png",
  "image/heic",
] as const;

/**
 * Persist an uploaded file + run extraction inline (synchronous for
 * Phase 1). Stage 07 may move extraction to Inngest; the contract is
 * the same — `caseDocuments.extractionStatus` flips when done.
 *
 * Idempotent on `(case_id, sha256)` via the partial unique index — a
 * second upload of the same bytes throws CONFLICT.
 */
export async function uploadAndExtract(args: {
  caseId: string;
  uploadedBy: string;
  documentType: (typeof DOCUMENT_TYPES)[number];
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ documentId: string }> {
  const sizeBytes = args.bytes.length;
  if (sizeBytes === 0) throw new AppError("BAD_REQUEST", "file is empty");
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new AppError(
      "BAD_REQUEST",
      `file exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB cap`,
    );
  }
  if (!isAllowedMime(args.mimeType)) {
    throw new AppError("BAD_REQUEST", `MIME not allowed: ${args.mimeType}`);
  }

  const sha256 = createHash("sha256").update(args.bytes).digest("hex");

  // Insert metadata first (in a tx) so we have an id for the storage key.
  // If storage.put fails, the row is rolled back.
  const documentId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(caseDocuments)
      .values({
        caseId: args.caseId,
        uploadedBy: args.uploadedBy,
        documentType: args.documentType,
        originalFilename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: BigInt(sizeBytes),
        sha256,
        // Placeholder; we update with real key once we have the id.
        storagePath: "pending",
        extractionStatus: "pending",
      })
      .onConflictDoNothing({
        target: [caseDocuments.caseId, caseDocuments.sha256],
        where: caseDocumentsActiveWhere(),
      })
      .returning({ id: caseDocuments.id });

    if (!inserted) {
      throw new AppError(
        "CONFLICT",
        "duplicate file (same SHA-256 already on this case)",
      );
    }

    const key = documentKey({
      caseId: args.caseId,
      documentId: inserted.id,
      filename: args.filename,
    });

    await tx
      .update(caseDocuments)
      .set({ storagePath: key })
      .where(eq(caseDocuments.id, inserted.id));

    await tx.insert(caseEvents).values({
      caseId: args.caseId,
      actorType: "user",
      actorUserId: args.uploadedBy,
      eventType: "document.uploaded",
      details: {
        documentId: inserted.id,
        documentType: args.documentType,
        sizeBytes,
      },
    });

    // Storage write happens inside the tx so a failed put rolls back the
    // metadata. (LocalStorage.put isn't transactional itself, but a
    // throw here unwinds the DB rows. An orphan file on rollback is
    // possible — see open_issues #15 for the cleanup-job follow-up.)
    await storage.put(key, args.bytes, { mimeType: args.mimeType });

    return inserted.id;
  });

  // Extract OUTSIDE the transaction — extraction can take seconds for big
  // PDFs, and we don't want to hold the DB row lock that long. The result
  // updates the row independently.
  await extractAndPersist(documentId, args.bytes, args.mimeType, db);

  return { documentId };
}

/** Re-runnable: idempotent based on extractionStatus. */
export async function extractAndPersist(
  documentId: string,
  bytes: Buffer,
  mimeType: string,
  conn: Db,
): Promise<void> {
  await conn
    .update(caseDocuments)
    .set({ extractionStatus: "processing" })
    .where(eq(caseDocuments.id, documentId));

  const result = await extract({ bytes, mimeType });

  if ("error" in result) {
    await conn
      .update(caseDocuments)
      .set({
        extractionStatus: "failed",
        extractionError: result.error,
        extractedAt: new Date(),
      })
      .where(eq(caseDocuments.id, documentId));
    return;
  }

  await conn
    .update(caseDocuments)
    .set({
      extractionStatus: "completed",
      extractedText: result.text,
      extractedAt: new Date(),
      extractionError: null,
    })
    .where(eq(caseDocuments.id, documentId));
}

function isAllowedMime(mime: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/** Reused WHERE for the partial unique index on case_documents. */
function caseDocumentsActiveWhere() {
  return sql`${caseDocuments.deletedAt} is null`;
}
