import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { attorneyProfiles, signedDocuments } from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/api/trpc";
import { TERMS_VERSION } from "@/server/auth/terms";
import {
  CONTRACTOR_AGREEMENT_KIND,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";
import { emitFromCtx } from "@/server/services/analytics/emit";
import { barNumberSchema, usStateCodeSchema } from "@/lib/validators";

/**
 * Attorney-side procedures: onboarding form submission. Status flips
 * pending → pending+submitted; admin then activates via
 * `admin.activateAttorney`.
 *
 * The contractor agreement is signed in a separate step via
 * `signature.signContractorAgreement`; the resulting signature id is
 * passed in here. We re-validate ownership + kind + version + not
 * revoked at submission time so a version bump between Step 1 and
 * Step 2 forces a re-sign.
 */

const SubmitOnboardingInput = z.object({
  // Bar-number contract is enforced by `barNumberSchema` (uppercase
  // alphanumeric + hyphen, 2-30 chars). Caller doesn't need to
  // pre-normalize — the schema does both transform and validation.
  barNumber: barNumberSchema,
  // USPS state codes — closed enum from `lib/validators.ts` (50
  // states + DC + 5 inhabited territories). The schema pre-uppercases
  // so the form can submit mixed case without an extra trim step.
  barStates: z.array(usStateCodeSchema).min(1).max(50),
  // Must equal the current TERMS_VERSION. Rejects stale or fake versions.
  termsAcceptedVersion: z.literal(TERMS_VERSION),
  signatureId: z.string().uuid(),
});

export const attorneyRouter = router({
  submitOnboarding: protectedProcedure
    .input(SubmitOnboardingInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      const [profile] = await db
        .select({
          id: attorneyProfiles.id,
          status: attorneyProfiles.status,
          submittedAt: attorneyProfiles.submittedAt,
        })
        .from(attorneyProfiles)
        .where(
          and(
            eq(attorneyProfiles.userId, userId),
            isNull(attorneyProfiles.deletedAt),
          ),
        )
        .limit(1);

      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Attorney profile missing — sign out and back in to repair.",
        });
      }

      // attorneyStatusEnum: pending | active | suspended | inactive
      if (profile.status === "active") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Already active — onboarding already complete.",
        });
      }
      if (profile.status === "suspended" || profile.status === "inactive") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Account ${profile.status}. Contact support.`,
        });
      }

      // Verify the signature row is the caller's, the right kind, the
      // current version, and not revoked. The signed_documents RLS
      // policy already restricts SELECT to the caller, but we re-check
      // explicitly so version drift surfaces as a clear app-level
      // error rather than a silent NOT_FOUND.
      const [signature] = await db
        .select({
          userId: signedDocuments.userId,
          documentKind: signedDocuments.documentKind,
          documentVersion: signedDocuments.documentVersion,
          signedAt: signedDocuments.signedAt,
          revokedAt: signedDocuments.revokedAt,
        })
        .from(signedDocuments)
        .where(eq(signedDocuments.id, input.signatureId))
        .limit(1);

      if (
        !signature ||
        signature.userId !== userId ||
        signature.documentKind !== CONTRACTOR_AGREEMENT_KIND ||
        signature.revokedAt !== null
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign the contractor agreement before submitting onboarding.",
        });
      }
      if (signature.documentVersion !== CONTRACTOR_AGREEMENT_VERSION) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The contractor agreement was updated. Please re-read and sign the latest version.",
        });
      }

      const now = new Date();

      await db
        .update(attorneyProfiles)
        .set({
          // `barNumber` and `barStates` are already trimmed +
          // uppercased by the input schema in `lib/validators.ts`.
          barNumber: input.barNumber,
          barStates: input.barStates,
          acceptedTermsVersion: input.termsAcceptedVersion,
          // Denormalized convenience flag — legal record is the
          // signed_documents row referenced by `input.signatureId`.
          agreementSignedAt: signature.signedAt,
          submittedAt: now,
        })
        .where(eq(attorneyProfiles.id, profile.id));

      // attorney_id == users.id (the canonical identity used for
      // PostHog `distinctId`, RLS, audit-log target_id). NOT
      // attorneyProfiles.id — that's an implementation detail that
      // would prevent joining this event with `auth.signed_in` or any
      // user-keyed query in PostHog.
      emitFromCtx(ctx, {
        name: "attorney.onboarded",
        properties: { attorney_id: userId },
      });

      return { ok: true as const, submittedAt: now };
    }),
});
