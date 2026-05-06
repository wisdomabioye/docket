import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db/client";
import { signedDocuments } from "@/server/db/schema";
import { storage } from "@/server/services/storage";
import { renderPdfToBuffer, signaturePdfKey } from "@/server/services/pdf/render";
import { ContractorAgreementPdf } from "@/server/services/pdf/contractor-agreement";
import { insertAuditEntry } from "@/server/services/audit";
import {
  CONTRACTOR_AGREEMENT_BODY,
  CONTRACTOR_AGREEMENT_HASH,
  CONTRACTOR_AGREEMENT_KIND,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";

/**
 * Stage 03b — server-side e-signature flows.
 *
 * The service uses the owner-role `db` import (NOT a tRPC ctx.db)
 * for both the signature INSERT and the audit-log INSERT. This is
 * intentional and has consequences worth being explicit about:
 *
 *   - The `audit_log` table is admin-only at the RLS layer
 *     (migration 0005), so a non-admin caller's RLS-engaged ctx.db
 *     could not insert the audit row. Co-locating both inserts under
 *     the owner role keeps them in one tx — if either fails, both
 *     roll back.
 *   - As a side effect, the signature INSERT also bypasses
 *     `signed_documents` RLS. The self-INSERT/SELECT policies in
 *     migration 0023 therefore act as a guard against off-path
 *     callers (e.g., a future ctx.db query that forgets to filter
 *     by `user_id`), not against this service. That's a real but
 *     narrow protection.
 *
 * Ownership is enforced explicitly here: the caller passes `userId`
 * from the verified tRPC session, and `getSignedPdfDownloadUrl`
 * checks ownership/admin in app code before returning a URL.
 */

export type ContractorSignature = {
  id: string;
  userId: string;
  /** Always `'contractor_agreement'` for rows returned from this
   *  service — narrowed by the caller's filter, not by `as const` on
   *  the row, so a future kind misrouted through this code path
   *  surfaces the actual value rather than being silently relabeled. */
  documentKind: string;
  documentVersion: string;
  contentHash: string;
  fullLegalName: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  renderedPdfPath: string | null;
};

/** Signed-URL TTL for contractor-agreement PDFs. Kept tighter than the
 *  Stage 08 case-PDF default (10 min) because the link is shared in
 *  small surfaces (admin detail page, owner's onboarding form) and a
 *  shorter window narrows the leak blast radius. */
const SIGNATURE_DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Fetch the active (un-revoked) contractor-agreement signature for a
 * user, if any. Returns null when none exists.
 */
export async function getActiveContractorSignature(
  userId: string,
): Promise<ContractorSignature | null> {
  const [row] = await db
    .select()
    .from(signedDocuments)
    .where(
      and(
        eq(signedDocuments.userId, userId),
        eq(signedDocuments.documentKind, CONTRACTOR_AGREEMENT_KIND),
        eq(signedDocuments.documentVersion, CONTRACTOR_AGREEMENT_VERSION),
        isNull(signedDocuments.revokedAt),
      ),
    )
    .limit(1);
  return row ? rowToSignature(row) : null;
}

/**
 * Sign the contractor agreement on behalf of `userId`. Idempotent:
 * if an active signature already exists for the same `(user, kind,
 * version)`, returns it without rendering a second PDF or writing a
 * second audit entry.
 *
 * Atomicity: the PDF render + storage put happen BEFORE the DB tx so
 * the row is only inserted once we have a persisted artifact.
 *
 * PDF orphaning — the honest version. Each invocation generates a
 * unique `signatureId` and uploads to a unique storage key BEFORE
 * the `INSERT … ON CONFLICT DO NOTHING`. So:
 *   - If the tx fails, the storage object is orphaned. Rare.
 *   - If two concurrent first-time signers race (legitimate
 *     double-tab / double-click), the loser also leaves an orphan.
 *     This is normal under load, not just an error path.
 * Both are acceptable for Phase 1 — a periodic cleanup script can
 * reconcile `users/<userId>/signatures/` against `signed_documents`.
 * The reverse (DB row without a PDF) is the legally bad state and is
 * what the render-then-insert ordering prevents.
 */
export async function signContractorAgreement(args: {
  userId: string;
  fullLegalName: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ signature: ContractorSignature; wasNew: boolean }> {
  const existing = await getActiveContractorSignature(args.userId);
  if (existing) return { signature: existing, wasNew: false };

  const signatureId = crypto.randomUUID();
  const signedAt = new Date();
  const pdfKey = signaturePdfKey({
    userId: args.userId,
    signatureId,
  });

  const pdfBytes = await renderPdfToBuffer(
    ContractorAgreementPdf({
      body: CONTRACTOR_AGREEMENT_BODY,
      fullLegalName: args.fullLegalName,
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      signedAt,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    }),
  );
  await storage.put(pdfKey, pdfBytes, { mimeType: "application/pdf" });

  return await db.transaction(async (rawTx) => {
    // Cast mirrors `server/api/trpc.ts` — the project's `Db` alias
    // covers both the top-level client and any tx descended from it,
    // and our helpers (`insertAuditEntry`) type their `db` field
    // against that alias.
    const tx = rawTx as unknown as typeof db;

    // Race-safe INSERT. With Postgres `read committed` (the default),
    // a SELECT-then-INSERT pattern doesn't actually serialize
    // concurrent first-time signers — both transactions can find no
    // existing row and both proceed to INSERT. The partial unique
    // index `signed_documents_user_kind_version_uniq` is what
    // guarantees at most one row; ON CONFLICT DO NOTHING converts the
    // loser's constraint violation into an empty `returning()` so we
    // can refetch the winning row instead of bubbling a 500.
    const [inserted] = await tx
      .insert(signedDocuments)
      .values({
        id: signatureId,
        userId: args.userId,
        documentKind: CONTRACTOR_AGREEMENT_KIND,
        documentVersion: CONTRACTOR_AGREEMENT_VERSION,
        contentHash: CONTRACTOR_AGREEMENT_HASH,
        fullLegalName: args.fullLegalName,
        signedAt,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
        renderedPdfPath: pdfKey,
      })
      .onConflictDoNothing({
        target: [
          signedDocuments.userId,
          signedDocuments.documentKind,
          signedDocuments.documentVersion,
        ],
        where: sql`${signedDocuments.revokedAt} is null`,
      })
      .returning();

    if (!inserted) {
      // Conflict — a concurrent tx won the race. Refetch the winning
      // row (RLS-bypassing owner role here, same as the rest of this
      // service). The PDF we just rendered + uploaded is now an
      // orphan; the storage-cleanup story is documented above.
      const [winner] = await tx
        .select()
        .from(signedDocuments)
        .where(
          and(
            eq(signedDocuments.userId, args.userId),
            eq(signedDocuments.documentKind, CONTRACTOR_AGREEMENT_KIND),
            eq(signedDocuments.documentVersion, CONTRACTOR_AGREEMENT_VERSION),
            isNull(signedDocuments.revokedAt),
          ),
        )
        .limit(1);
      if (!winner) {
        // The unique index rejected our INSERT but no surviving row
        // matches — should be unreachable unless someone revoked the
        // winning row between the conflict and this SELECT. Surface
        // as 500 so it shows up in Sentry.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Signature insert raced and no winner is visible.",
        });
      }
      // Loser of the race — winner already had its audit row
      // written by the winning tx; not a fresh sign for analytics.
      return { signature: rowToSignature(winner), wasNew: false };
    }

    await insertAuditEntry({
      db: tx,
      actorUserId: args.userId,
      action: "signature.signed",
      targetType: "signed_document",
      targetId: inserted.id,
      details: {
        documentKind: CONTRACTOR_AGREEMENT_KIND,
        documentVersion: CONTRACTOR_AGREEMENT_VERSION,
        contentHash: CONTRACTOR_AGREEMENT_HASH,
      },
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });

    return { signature: rowToSignature(inserted), wasNew: true };
  });
}

/**
 * Resolve a 5-minute signed download URL for a signature's rendered
 * PDF. Authorizes: the signature owner OR an admin caller. Throws
 * `NOT_FOUND` for missing rows; throws `FORBIDDEN` when the requester
 * is neither owner nor admin (the same response shape so a non-owner
 * cannot enumerate signature ids by error code).
 */
export async function getSignedPdfDownloadUrl(args: {
  signatureId: string;
  requesterId: string;
  isAdmin: boolean;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const [row] = await db
    .select({
      userId: signedDocuments.userId,
      renderedPdfPath: signedDocuments.renderedPdfPath,
      revokedAt: signedDocuments.revokedAt,
    })
    .from(signedDocuments)
    .where(eq(signedDocuments.id, args.signatureId))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Signature not found." });
  }
  if (!args.isAdmin && row.userId !== args.requesterId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Signature not found." });
  }
  if (row.revokedAt) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Signature has been revoked.",
    });
  }
  if (!row.renderedPdfPath) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Signature is missing its rendered PDF — contact support.",
    });
  }

  const url = await storage.signedUrl(row.renderedPdfPath, {
    expiresInSeconds: SIGNATURE_DOWNLOAD_URL_TTL_SECONDS,
  });
  return { url, expiresInSeconds: SIGNATURE_DOWNLOAD_URL_TTL_SECONDS };
}

function rowToSignature(row: {
  id: string;
  userId: string;
  documentKind: string;
  documentVersion: string;
  contentHash: string;
  fullLegalName: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  renderedPdfPath: string | null;
}): ContractorSignature {
  return {
    id: row.id,
    userId: row.userId,
    documentKind: row.documentKind,
    documentVersion: row.documentVersion,
    contentHash: row.contentHash,
    fullLegalName: row.fullLegalName,
    signedAt: row.signedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    renderedPdfPath: row.renderedPdfPath,
  };
}
