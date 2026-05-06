import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/api/trpc";
import { readIp, readUserAgent } from "@/server/api/headers";
import {
  CONTRACTOR_AGREEMENT_HASH,
  CONTRACTOR_AGREEMENT_KIND,
  CONTRACTOR_AGREEMENT_TITLE,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";
import {
  getActiveContractorSignature,
  getSignedPdfDownloadUrl,
  signContractorAgreement,
} from "@/server/services/signatures";
import { emitFromCtx } from "@/server/services/analytics/emit";

/**
 * Stage 03b — e-signature surface. `protectedProcedure` (any signed-in
 * user, not `attorneyProcedure`) because pending attorneys must be
 * able to sign before activation, and Phase 2 applicants will sign
 * other kinds against the same generic table.
 */

const SignContractorAgreementInput = z.object({
  // Locked literals: any drift means the body or version has shifted
  // since the page rendered. Server tells the client to refresh.
  documentVersion: z.literal(CONTRACTOR_AGREEMENT_VERSION),
  contentHash: z.literal(CONTRACTOR_AGREEMENT_HASH),
  fullLegalName: z.string().trim().min(2).max(120),
  // ESIGN/UETA intent — must be the literal `true`. A missing or
  // false value rejects at the boundary.
  intentAcknowledged: z.literal(true),
});

const GetDownloadUrlInput = z.object({
  id: z.string().uuid(),
});

export const signatureRouter = router({
  signContractorAgreement: protectedProcedure
    .input(SignContractorAgreementInput)
    .mutation(async ({ ctx, input }) => {
      const ipAddress = readIp(ctx.headers);
      const userAgent = readUserAgent(ctx.headers);
      const { signature, wasNew } = await signContractorAgreement({
        userId: ctx.userId,
        fullLegalName: input.fullLegalName,
        ipAddress,
        userAgent,
      });
      // Funnel analytics: fire once per actual sign so the Step 1 →
      // Step 2 dropoff is measurable. Idempotent / racing-loser
      // returns are NOT counted — the audit log captures every
      // call, PostHog captures sign events.
      if (wasNew) {
        emitFromCtx(ctx, {
          name: "signature.signed",
          properties: {
            signature_id: signature.id,
            document_kind: CONTRACTOR_AGREEMENT_KIND,
            document_version: signature.documentVersion,
          },
        });
      }
      return {
        id: signature.id,
        signedAt: signature.signedAt,
        documentVersion: signature.documentVersion,
        title: CONTRACTOR_AGREEMENT_TITLE,
      };
    }),

  /** Returns the active contractor-agreement signature for the
   *  current user (or null). Used by the onboarding page to pick
   *  which step to render. */
  getMyContractorSignature: protectedProcedure.query(async ({ ctx }) => {
    const sig = await getActiveContractorSignature(ctx.userId);
    if (!sig) return null;
    return {
      id: sig.id,
      signedAt: sig.signedAt,
      fullLegalName: sig.fullLegalName,
      documentVersion: sig.documentVersion,
      contentHash: sig.contentHash,
    };
  }),

  /** Time-bounded signed URL to the rendered PDF. Owner or admin
   *  only. Modeled as a mutation because each call mints a fresh
   *  short-lived URL — caching is undesirable. */
  getDownloadUrl: protectedProcedure
    .input(GetDownloadUrlInput)
    .mutation(async ({ ctx, input }) => {
      const [adminRow] = await ctx.db.execute<{ ok: boolean }>(
        sql`select is_admin() as ok`,
      );
      const isAdmin = Boolean(adminRow?.ok);
      return await getSignedPdfDownloadUrl({
        signatureId: input.id,
        requesterId: ctx.userId,
        isAdmin,
      });
    }),
});
