import { TRPCError } from "@trpc/server";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attorneyProfiles,
  auditLog,
  users,
  waitlistEntries,
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

  /**
   * Waitlist + invite gate. `listWaitlist` returns every non-deleted entry
   * newest-first with approval status joined; `approveWaitlistEntry` flips
   * `approved_at` so the email can complete OAuth sign-in.
   *
   * No pagination yet — the queue is small in early access. Add a cursor
   * once it crosses ~200 entries.
   */
  listWaitlist: adminProcedure.query(async ({ ctx }) => {
    const approver = alias(users, "approver");
    const rows = await ctx.db
      .select({
        id: waitlistEntries.id,
        email: waitlistEntries.email,
        name: waitlistEntries.name,
        source: waitlistEntries.source,
        createdAt: waitlistEntries.createdAt,
        approvedAt: waitlistEntries.approvedAt,
        approvedByEmail: approver.email,
      })
      .from(waitlistEntries)
      .leftJoin(approver, eq(approver.id, waitlistEntries.approvedBy))
      .where(isNull(waitlistEntries.deletedAt))
      .orderBy(desc(waitlistEntries.createdAt));
    return rows;
  }),

  approveWaitlistEntry: adminProcedure
    .input(z.object({ entryId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId: adminId } = ctx;

      // Atomic guard: only flip the row if it's still un-approved AND
      // not soft-deleted. `returning` tells us whether anything changed,
      // so we can distinguish "not found" from "already approved" without
      // a separate read+write race.
      const updated = await db
        .update(waitlistEntries)
        .set({ approvedAt: sql`now()`, approvedBy: adminId })
        .where(
          and(
            eq(waitlistEntries.id, input.entryId),
            isNull(waitlistEntries.approvedAt),
            isNull(waitlistEntries.deletedAt),
          ),
        )
        .returning({ id: waitlistEntries.id, email: waitlistEntries.email });

      if (updated.length === 0) {
        // Disambiguate by re-reading. Cheap; runs only on the unhappy path.
        const [existing] = await db
          .select({
            id: waitlistEntries.id,
            approvedAt: waitlistEntries.approvedAt,
            deletedAt: waitlistEntries.deletedAt,
          })
          .from(waitlistEntries)
          .where(eq(waitlistEntries.id, input.entryId))
          .limit(1);

        if (!existing || existing.deletedAt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Waitlist entry not found",
          });
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "Waitlist entry is already approved",
        });
      }

      const row = updated[0]!;
      await db.insert(auditLog).values({
        actorType: "user",
        actorUserId: adminId,
        action: "waitlist.approve",
        targetType: "waitlist_entry",
        targetId: row.id,
        details: { email: row.email },
      });

      return { ok: true as const };
    }),
});
