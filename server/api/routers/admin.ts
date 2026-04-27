import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  attorneyProfiles,
  auditLog,
  users,
} from "@/server/db/schema";
import { adminProcedure, router } from "@/server/api/trpc";

/**
 * Admin-only procedures. Stage 09 expands this into the full admin
 * dashboard (revenue, compute, audit log browser). Stage 03 ships the
 * minimum needed to activate pending attorneys.
 */

export const adminRouter = router({
  /** Attorneys waiting for activation — most recent submissions first. */
  listPendingAttorneys: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        barNumber: attorneyProfiles.barNumber,
        barStates: attorneyProfiles.barStates,
        submittedAt: attorneyProfiles.submittedAt,
        agreementSignedAt: attorneyProfiles.agreementSignedAt,
      })
      .from(attorneyProfiles)
      .innerJoin(users, eq(users.id, attorneyProfiles.userId))
      .where(
        and(
          eq(attorneyProfiles.status, "pending"),
          isNotNull(attorneyProfiles.submittedAt),
          isNull(attorneyProfiles.deletedAt),
          // Hide soft-deleted users even if their profile is intact.
          isNull(users.deletedAt),
        ),
      )
      .orderBy(desc(attorneyProfiles.submittedAt));
    return rows;
  }),

  activateAttorney: adminProcedure
    .input(
      z.object({
        userId: z.uuid(),
        // `.min(1)` rejects the empty string up front. Without it,
        // `reason: ""` would silently coerce to null details.
        reason: z.string().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;

      const [profile] = await db
        .select({
          id: attorneyProfiles.id,
          status: attorneyProfiles.status,
          submittedAt: attorneyProfiles.submittedAt,
        })
        .from(attorneyProfiles)
        .where(
          and(
            eq(attorneyProfiles.userId, input.userId),
            isNull(attorneyProfiles.deletedAt),
          ),
        )
        .limit(1);

      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Attorney profile not found",
        });
      }
      if (profile.status === "active") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Attorney is already active",
        });
      }
      if (!profile.submittedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Attorney has not submitted onboarding yet",
        });
      }

      await db
        .update(attorneyProfiles)
        .set({ status: "active" })
        .where(eq(attorneyProfiles.id, profile.id));

      await db.insert(auditLog).values({
        actorType: "user",
        actorUserId: adminId,
        action: "attorney.activate",
        targetType: "user",
        targetId: input.userId,
        details: input.reason ? { reason: input.reason } : null,
      });

      return { ok: true as const };
    }),
});
