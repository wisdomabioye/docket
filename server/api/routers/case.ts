import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
} from "drizzle-orm";
import { z } from "zod";
import {
  caseEvents,
  caseParticipants,
  cases,
  organizationMembers,
  visaTypeEnum,
  caseStatusEnum,
} from "@/server/db/schema";
import { BeneficiaryDataSchema } from "@/server/db/schema/zod";
import { db as ownerDb, type Db } from "@/server/db/client";
import { protectedProcedure, router } from "@/server/api/trpc";
import { transitionCase } from "@/server/services/cases/transition";
import { AppError } from "@/lib/errors";

/**
 * Case management — Stage 05. Status transitions go through
 * `transitionCase()` (single mutation point per `lib/case-status.ts`).
 * RLS scopes reads to participants; admin RLS bypass handled at the
 * policy level.
 */

const ListPageSize = 25;

const CreateInput = z.object({
  visaType: z.enum(visaTypeEnum.enumValues),
  beneficiaryData: BeneficiaryDataSchema.optional(),
  reviewSlaHours: z.number().int().min(1).max(720).optional(),
});

const ListInput = z.object({
  status: z.array(z.enum(caseStatusEnum.enumValues)).min(1).optional(),
  visaType: z.array(z.enum(visaTypeEnum.enumValues)).min(1).optional(),
  cursor: z
    .object({
      createdAt: z.iso.datetime(),
      id: z.uuid(),
    })
    .optional(),
});

const UpdateBeneficiaryInput = z.object({
  caseId: z.uuid(),
  patch: BeneficiaryDataSchema, // already partial+strict
  expectedRowRevision: z.number().int().nonnegative(),
});

const CompleteIntakeInput = z.object({
  caseId: z.uuid(),
  expectedRowRevision: z.number().int().nonnegative(),
});

const ArchiveInput = z.object({
  caseId: z.uuid(),
  reason: z.string().min(1).max(500).optional(),
});

const GetInput = z.object({ caseId: z.uuid() });

export const caseRouter = router({
  create: protectedProcedure
    .input(CreateInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      // Determine the caller's organization. Phase 1 each attorney has
      // exactly one org (auto-provisioned at sign-in). Pick the first.
      const [membership] = await db
        .select({ orgId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, userId),
            isNull(organizationMembers.removedAt),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No organization for this user — sign out and back in to repair onboarding.",
        });
      }

      // Bootstrap inserts run via the owner connection (RLS bypassed).
      // Why: the cases / case_participants RLS policies require an
      // existing participant row to satisfy `user_in_case()`, but on
      // initial create no such row exists yet. App-layer auth (the
      // membership check above) is the gate; RLS is bypassed only for
      // this bootstrap. See `docs/architecture.md` §RLS for the pattern.
      const id = await ownerDb.transaction(async (tx) => {
        const [created] = await tx
          .insert(cases)
          .values({
            organizationId: membership.orgId,
            visaType: input.visaType,
            status: "intake",
            beneficiaryData: input.beneficiaryData,
            reviewSlaHours: input.reviewSlaHours ?? 72,
          })
          .returning({ id: cases.id });

        if (!created) throw new Error("case insert returned no id");

        await tx.insert(caseParticipants).values({
          caseId: created.id,
          userId,
          role: "attorney",
          isPrimary: true,
        });

        await tx.insert(caseEvents).values({
          caseId: created.id,
          actorType: "user",
          actorUserId: userId,
          eventType: "case.created",
          details: { visaType: input.visaType },
        });

        return created.id;
      });

      return { id };
    }),

  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    const { db } = ctx;

    const filters = [isNull(cases.deletedAt)];
    if (input.status?.length) filters.push(inArray(cases.status, input.status));
    if (input.visaType?.length)
      filters.push(inArray(cases.visaType, input.visaType));
    if (input.cursor) {
      // Keyset pagination: createdAt-only. Two cases with identical
      // timestamps could fall on the page boundary (open_issues #13.3) —
      // vanishingly rare with millisecond defaults. Phase 2 adds the
      // `id` tiebreaker via `(createdAt, id) < (cursor.createdAt, cursor.id)`.
      filters.push(lt(cases.createdAt, new Date(input.cursor.createdAt)));
    }

    const rows = await db
      .select({
        id: cases.id,
        visaType: cases.visaType,
        status: cases.status,
        beneficiaryData: cases.beneficiaryData,
        reviewSlaHours: cases.reviewSlaHours,
        createdAt: cases.createdAt,
        updatedAt: cases.updatedAt,
      })
      .from(cases)
      .where(and(...filters))
      .orderBy(desc(cases.createdAt), desc(cases.id))
      .limit(ListPageSize + 1);

    const hasMore = rows.length > ListPageSize;
    const items = hasMore ? rows.slice(0, ListPageSize) : rows;
    const nextCursor =
      hasMore && items.length > 0
        ? {
            createdAt: items[items.length - 1]!.createdAt.toISOString(),
            id: items[items.length - 1]!.id,
          }
        : null;

    return { items, nextCursor };
  }),

  get: protectedProcedure.input(GetInput).query(async ({ ctx, input }) => {
    const { db } = ctx;
    const [row] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
      .limit(1);

    if (!row) return null; // RLS or truly missing — same to caller

    const participants = await db
      .select({
        userId: caseParticipants.userId,
        role: caseParticipants.role,
        isPrimary: caseParticipants.isPrimary,
      })
      .from(caseParticipants)
      .where(
        and(
          eq(caseParticipants.caseId, input.caseId),
          isNull(caseParticipants.removedAt),
        ),
      );

    const events = await db
      .select({
        id: caseEvents.id,
        actorType: caseEvents.actorType,
        actorUserId: caseEvents.actorUserId,
        eventType: caseEvents.eventType,
        details: caseEvents.details,
        createdAt: caseEvents.createdAt,
      })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, input.caseId))
      .orderBy(desc(caseEvents.createdAt))
      .limit(50);

    return { ...row, participants, events };
  }),

  updateBeneficiary: protectedProcedure
    .input(UpdateBeneficiaryInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      const [row] = await db
        .select({
          id: cases.id,
          status: cases.status,
          rowRevision: cases.rowRevision,
          beneficiaryData: cases.beneficiaryData,
        })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }
      if (row.rowRevision !== input.expectedRowRevision) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `case was modified (revision ${row.rowRevision}, expected ${input.expectedRowRevision})`,
        });
      }
      // Beneficiary edits are only meaningful before the build pipeline
      // commits to a draft. Lock once we've gone past intake.
      if (row.status !== "intake" && row.status !== "documents_pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `beneficiary data is locked once status is ${row.status}`,
        });
      }

      // Reject empty patch — Zod accepts `{}` since the schema is
      // `.partial()`, but applying it would just bump row_revision and
      // write a no-op event with `{ fields: [] }`. Surface the no-op
      // up front so callers (forms, scripts) can decide what to do.
      const patchKeys = Object.keys(input.patch);
      if (patchKeys.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Patch is empty — no fields to update.",
        });
      }

      // Merge: existing jsonb + patch (patch wins). `BeneficiaryDataSchema`
      // is `.partial().strict()` so unknown fields would have already
      // been rejected at the boundary.
      const merged = { ...(row.beneficiaryData ?? {}), ...input.patch };

      // Mutations on owner connection: case_events has no participant
      // INSERT policy, so user-scoped writes would fail RLS. Authz
      // already validated by the RLS-engaged read above.
      await ownerDb.transaction(async (tx) => {
        await tx
          .update(cases)
          .set({ beneficiaryData: merged })
          .where(eq(cases.id, input.caseId));

        await tx.insert(caseEvents).values({
          caseId: input.caseId,
          actorType: "user",
          actorUserId: userId,
          eventType: "case.beneficiary_updated",
          details: { fields: Object.keys(input.patch) },
        });
      });

      return { ok: true as const };
    }),

  completeIntake: protectedProcedure
    .input(CompleteIntakeInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      // Authz: ensure the caller can see the case (RLS).
      const [authz] = await db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!authz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }

      // transitionCase writes case_events; needs owner role.
      try {
        const result = await ownerDb.transaction(async (tx) =>
          transitionCase({
            tx: tx as unknown as Db,
            caseId: input.caseId,
            toStatus: "documents_pending",
            actor: { type: "user", userId },
            expectedRowRevision: input.expectedRowRevision,
            reason: "intake form submitted",
          }),
        );
        return { ok: true as const, ...result };
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({ code: appErrorCode(err.code), message: err.message });
        }
        throw err;
      }
    }),

  archive: protectedProcedure
    .input(ArchiveInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      // Authorize via the user-scoped tx (RLS engaged). If the caller
      // can't see the case, RLS returns no row → NOT_FOUND.
      const [authzCheck] = await db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!authzCheck) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }

      // Mutations run on the owner connection: setting `deleted_at` flips
      // the cases policy's WITH CHECK to false (`deleted_at is null`),
      // so RLS would otherwise reject the update. App-layer auth (the
      // read above) is the gate.
      try {
        await ownerDb.transaction(async (tx) => {
          await transitionCase({
            tx: tx as unknown as Db,
            caseId: input.caseId,
            toStatus: "archived",
            actor: { type: "user", userId },
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          });
          await tx
            .update(cases)
            .set({ deletedAt: new Date() })
            .where(eq(cases.id, input.caseId));
        });
        return { ok: true as const };
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({ code: appErrorCode(err.code), message: err.message });
        }
        throw err;
      }
    }),
});

function appErrorCode(c: string): "CONFLICT" | "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR" {
  if (c === "CONFLICT") return "CONFLICT";
  if (c === "NOT_FOUND") return "NOT_FOUND";
  if (c === "BAD_REQUEST") return "BAD_REQUEST";
  return "INTERNAL_SERVER_ERROR";
}
