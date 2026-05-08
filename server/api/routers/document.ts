import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  caseDocuments,
  caseEvents,
  cases,
  documentTypeEnum,
  type caseStatusEnum,
} from "@/server/db/schema";
import { db as ownerDb } from "@/server/db/client";
import { protectedProcedure, router } from "@/server/api/trpc";
import {
  ALLOWED_MIME_TYPES,
  uploadAndExtract,
} from "@/server/services/cases/documents";
import { storage } from "@/server/services/storage";
import { appErrorToTrpcCode, isAppError } from "@/lib/errors";
import { canUploadInStatus } from "@/lib/case-status";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { emitFromCtx } from "@/server/services/analytics/emit";

/**
 * Document procedures. Per Stage 05 RLS pattern: read for authz via
 * ctx.db (RLS engaged), write via owner connection.
 *
 * Upload accepts the file as base64. Direct-to-bucket presigned upload
 * is logged in open_issues for Phase 2 — Phase 1 traffic is small enough
 * that the server can proxy the bytes.
 */

// Base64 inflates raw bytes by ~33%. Cap the encoded string at the
// matching ceiling — anything larger has no chance of passing the
// service's raw-byte cap, so we reject it before allocating a buffer.
const MAX_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES * 1.4);

const UploadInput = z.object({
  caseId: z.uuid(),
  filename: z.string().min(1).max(200),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  documentType: z.enum(documentTypeEnum.enumValues),
  contentBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
});

const ListInput = z.object({ caseId: z.uuid() });
const GetUrlInput = z.object({ documentId: z.uuid() });
const DeleteInput = z.object({ documentId: z.uuid() });

type CaseStatus = (typeof caseStatusEnum.enumValues)[number];

export const documentRouter = router({
  upload: protectedProcedure
    .input(UploadInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      // Authz: caller must be a participant on the case (RLS).
      const [authz] = await db
        .select({ id: cases.id, status: cases.status })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!authz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }
      // Status guard delegated to `lib/case-status.ts` so adding a new
      // status (or changing the rule) updates a single source of truth.
      if (!canUploadInStatus(authz.status as CaseStatus, input.documentType)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `uploads locked while status is ${authz.status}`,
        });
      }

      const bytes = decodeBase64(input.contentBase64);
      try {
        const { documentId } = await uploadAndExtract({
          caseId: input.caseId,
          uploadedBy: userId,
          filename: input.filename,
          mimeType: input.mimeType,
          documentType: input.documentType,
          bytes,
        });
        emitFromCtx(ctx, {
          name: "document.uploaded",
          properties: {
            case_id: input.caseId,
            document_id: documentId,
            document_type: input.documentType,
            size_bytes: bytes.byteLength,
            mime_type: input.mimeType,
          },
        });
        return { ok: true as const, documentId };
      } catch (err) {
        if (isAppError(err)) {
          throw new TRPCError({
            code: appErrorToTrpcCode(err.code),
            message: err.message,
          });
        }
        throw err;
      }
    }),

  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    const { db } = ctx;
    return db
      .select({
        id: caseDocuments.id,
        documentType: caseDocuments.documentType,
        originalFilename: caseDocuments.originalFilename,
        mimeType: caseDocuments.mimeType,
        sizeBytes: caseDocuments.sizeBytes,
        extractionStatus: caseDocuments.extractionStatus,
        extractionError: caseDocuments.extractionError,
        extractedAt: caseDocuments.extractedAt,
        createdAt: caseDocuments.createdAt,
      })
      .from(caseDocuments)
      .where(
        and(
          eq(caseDocuments.caseId, input.caseId),
          isNull(caseDocuments.deletedAt),
        ),
      )
      .orderBy(desc(caseDocuments.createdAt));
  }),

  getDownloadUrl: protectedProcedure
    .input(GetUrlInput)
    .query(async ({ ctx, input }) => {
      const { db } = ctx;
      const [doc] = await db
        .select({
          storagePath: caseDocuments.storagePath,
          originalFilename: caseDocuments.originalFilename,
        })
        .from(caseDocuments)
        .where(
          and(
            eq(caseDocuments.id, input.documentId),
            isNull(caseDocuments.deletedAt),
          ),
        )
        .limit(1);
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "document not found" });
      }
      const url = await storage.signedUrl(doc.storagePath, {
        expiresInSeconds: 300,
      });
      return { url, filename: doc.originalFilename };
    }),

  delete: protectedProcedure
    .input(DeleteInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      // Authz via ctx.db; mutation via owner.
      const [doc] = await db
        .select({
          id: caseDocuments.id,
          caseId: caseDocuments.caseId,
          storagePath: caseDocuments.storagePath,
        })
        .from(caseDocuments)
        .where(
          and(
            eq(caseDocuments.id, input.documentId),
            isNull(caseDocuments.deletedAt),
          ),
        )
        .limit(1);
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "document not found" });
      }

      await ownerDb.transaction(async (tx) => {
        await tx
          .update(caseDocuments)
          .set({ deletedAt: new Date() })
          .where(eq(caseDocuments.id, input.documentId));
        await tx.insert(caseEvents).values({
          caseId: doc.caseId,
          actorType: "user",
          actorUserId: userId,
          eventType: "document.deleted",
          details: { documentId: input.documentId },
        });
      });
      // Best-effort delete from storage. If the file is already gone we
      // still want the row soft-deleted.
      try {
        await storage.delete(doc.storagePath);
      } catch {
        /* ignore */
      }
      emitFromCtx(ctx, {
        name: "document.deleted",
        properties: { case_id: doc.caseId, document_id: input.documentId },
      });
      return { ok: true as const };
    }),
});

function decodeBase64(b64: string): Buffer {
  // Strip a data-URL prefix if present (`data:application/pdf;base64,...`).
  const comma = b64.indexOf(",");
  const payload =
    comma >= 0 && b64.startsWith("data:") ? b64.slice(comma + 1) : b64;
  return Buffer.from(payload, "base64");
}
