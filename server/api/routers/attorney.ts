import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { attorneyProfiles } from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/api/trpc";
import { TERMS_VERSION } from "@/server/auth/terms";
import { emitFromCtx } from "@/server/services/analytics/emit";

/**
 * Attorney-side procedures: onboarding form submission. Status flips
 * pending → pending+submitted; admin then activates via `admin.activateAttorney`.
 *
 * Phase 1 stub for the agreement upload — we accept a placeholder
 * `agreementFilename` string. Stage 06 wires real Supabase / S3 upload
 * and replaces this with a storage-path round-trip.
 */

const SubmitOnboardingInput = z.object({
  barNumber: z.string().min(2).max(60),
  // 2-letter ISO/USPS state codes. Server-side normalization to uppercase
  // so callers outside the form (tests, future API) can't store mixed-case.
  barStates: z.array(z.string().length(2)).min(1).max(50),
  // Must equal the current TERMS_VERSION. Rejects stale or fake versions.
  termsAcceptedVersion: z.literal(TERMS_VERSION),
  agreementFilename: z.string().min(1).max(200), // Stage 06 placeholder
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

      const normalizedBarStates = input.barStates.map((s) => s.toUpperCase());
      const now = new Date();

      await db
        .update(attorneyProfiles)
        .set({
          barNumber: input.barNumber,
          barStates: normalizedBarStates,
          acceptedTermsVersion: input.termsAcceptedVersion,
          // Storage path is a placeholder until Stage 06 wires real upload.
          agreementStoragePath: `pending-upload/${userId}/${input.agreementFilename}`,
          agreementSignedAt: now,
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
