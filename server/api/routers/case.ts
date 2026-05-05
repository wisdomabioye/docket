import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { bn, keysetLt } from "@/server/db/helpers";
import { z } from "zod";
import {
  caseDocuments,
  caseEvents,
  caseParticipants,
  caseRecommenders,
  cases,
  organizationMembers,
  visaTypeEnum,
  caseStatusEnum,
} from "@/server/db/schema";
import { BeneficiaryDataSchema } from "@/server/db/schema/zod";
import { db as ownerDb, type Db } from "@/server/db/client";
import {
  attorneyProcedure,
  protectedProcedure,
  router,
} from "@/server/api/trpc";
import {
  markBuildStarted,
  transitionCase,
} from "@/server/services/cases/transition";
import { meetsBuildRequirements } from "@/server/services/cases/readiness";
import { computeCriteriaCoverage } from "@/server/services/cases/criteria-coverage";
import { computePreflight } from "@/server/services/cases/preflight";
import { canRequestBuild } from "@/lib/case-status";
import {
  PER_CASE_STORAGE_BYTES,
  requiredDocsFor,
  visaCriteriaConfig,
} from "@/lib/visa-criteria";
import { rateLimit } from "@/server/services/ratelimit";
import { emitFromCtx } from "@/server/services/analytics/emit";
import { inngest } from "@/server/jobs/client";
import {
  buildEtaMinutes,
  caseArchivedNotificationEvent,
  caseBuildStartedNotificationEvent,
} from "@/server/services/email/notifications";
import { AppError, appErrorToTrpcCode } from "@/lib/errors";

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

const RequestBuildInput = z.object({ caseId: z.uuid() });

const ReadinessInput = z.object({ caseId: z.uuid() });

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

      emitFromCtx(ctx, {
        name: "case.created",
        properties: { case_id: id, visa_type: input.visaType },
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
      // Composite `(createdAt, id)` keyset cursor — see `keysetLt` for
      // why both columns are needed and why we truncate to milliseconds.
      filters.push(keysetLt(cases.createdAt, cases.id, input.cursor));
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

      // Authz: ensure the caller can see the case (RLS). Pulls
      // `visaType` + `beneficiaryData` so we can shape the analytics
      // event without a second round-trip.
      const [authz] = await db
        .select({
          id: cases.id,
          status: cases.status,
          visaType: cases.visaType,
          beneficiaryData: cases.beneficiaryData,
        })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!authz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }

      // Visa-specific recommender minimum (e.g. O-1A: 3). Visas without
      // an explicit minimum (`undefined`) skip this check. Only enforced
      // while the case is still in `intake` — `transitionCase` will
      // reject any post-intake status with the CONFLICT it deserves,
      // and we don't want to mask that with our own BAD_REQUEST.
      // Counted via RLS-engaged `ctx.db` so a forged caller can't
      // bypass it; the count runs AFTER authz so a non-participant
      // gets NOT_FOUND rather than the more revealing
      // "recommenders missing" error.
      const visaConfig = visaCriteriaConfig(authz.visaType);
      if (authz.status === "intake" && visaConfig?.minRecommenders) {
        const [{ count: recommenderCount = 0 } = { count: 0 }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(caseRecommenders)
          .where(
            and(
              eq(caseRecommenders.caseId, input.caseId),
              isNull(caseRecommenders.deletedAt),
            ),
          );
        if (recommenderCount < visaConfig.minRecommenders) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${authz.visaType} requires at least ${visaConfig.minRecommenders} recommenders before submitting intake — currently ${recommenderCount}.`,
          });
        }
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
        // `field_count` counts populated keys on the beneficiaryData
        // JSONB blob (BeneficiaryDataSchema is `.partial().strict()`,
        // so every key present represents a value the attorney
        // entered at some point). It is NOT a "non-empty value"
        // count — a key whose value was later cleared to `null`/`""`
        // still adds to the total. Coarse signal by design; we want
        // "how much intake did the attorney engage with" not "how
        // much survived the last edit."
        emitFromCtx(ctx, {
          name: "case.intake_submitted",
          properties: {
            case_id: input.caseId,
            visa_type: authz.visaType,
            field_count: authz.beneficiaryData
              ? Object.keys(authz.beneficiaryData).length
              : 0,
          },
        });
        return { ok: true as const, ...result };
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({ code: appErrorToTrpcCode(err.code), message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Read-only readiness probe — used by the build page (Stage 7 UI) to
   * render which gates are satisfied. Same predicate as `requestBuild`
   * uses internally, surfaced here so the UI can disable the CTA + show
   * specific gaps. Doesn't require an active attorney profile (read-only).
   */
  readiness: protectedProcedure
    .input(ReadinessInput)
    .query(async ({ ctx, input }) => {
      try {
        const r = await meetsBuildRequirements({
          db: ctx.db,
          caseId: input.caseId,
        });
        const statusOk = canRequestBuild(r.status);
        return {
          ok: r.ok && statusOk,
          status: r.status,
          statusOk,
          reasons: [...r.reasons],
        };
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({
            code: appErrorToTrpcCode(err.code),
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Kick off the build pipeline. Atomically:
   *   1. Per-user rate limit (`case.requestBuild` 10/hr, spec §17.5).
   *   2. RLS read confirms the user can see the case.
   *   3. Status guard via `canRequestBuild` (only `ready_to_build` /
   *      `build_failed` are allowed; other statuses → CONFLICT).
   *   4. `meetsBuildRequirements` content gate (intake + extracted docs).
   *   5. `transitionCase` to `building` inside a tx — the row lock
   *      serializes concurrent requests; only one wins, the other gets
   *      CONFLICT from `transitionCase`.
   *   6. Emit `case/build.requested` so the parent `case-build` Inngest
   *      function picks up. Concurrency=1 per case is the second
   *      defense in depth.
   *
   * Requires `attorneyProcedure` — reverted attorneys (status != active)
   * can't burn budget. The middleware already enforced that; we don't
   * re-check here.
   */
  requestBuild: attorneyProcedure
    .input(RequestBuildInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      // 1. Rate limit. User-id identifier (never IP — attorneys can
      // share a NAT). Bypassed in dev when Upstash isn't configured.
      const rl = await rateLimit("case.requestBuild", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Build rate limit reached (${rl.limit}/hour). Try again later.`,
        });
      }

      // 2. Single read pass: status (lifecycle gate) + content readiness.
      // `meetsBuildRequirements` runs through the RLS-engaged ctx.db so
      // an unauthorized caller throws NOT_FOUND with no content leak.
      let r;
      try {
        r = await meetsBuildRequirements({ db, caseId: input.caseId });
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({
            code: appErrorToTrpcCode(err.code),
            message: err.message,
          });
        }
        throw err;
      }

      // 3. Status guard.
      if (!canRequestBuild(r.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `case is in status ${r.status} — build can only be requested from ready_to_build or build_failed`,
        });
      }

      // 4. Content gate.
      if (!r.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `case not ready to build: ${r.reasons.join(" ")}`,
        });
      }

      // 5. Atomic transition + stamp `build_started_at` (via the
      // `markBuildStarted` helper which centralizes the timestamp
      // dance). transitionCase locks the row inside the tx; a
      // concurrent requestBuild for the same case waits, sees
      // status=building, and rejects with CONFLICT — the second click
      // can't double-emit the event.
      //
      // Why stamp `build_started_at` here (not just in the parent
      // function): if `inngest.send` below fails (network), the case is
      // already in `building`. Without this timestamp the watchdog's
      // `lt(buildStartedAt, now() - 30m)` predicate is FALSE for NULL,
      // so the case would be stuck in `building` forever. Stamping now
      // means the watchdog sweeps to `build_failed` after 30 min.
      // The parent's mark-building step will overwrite both timestamps
      // when it picks up — that's a refresh, not a regression.
      try {
        await ownerDb.transaction(async (tx) =>
          markBuildStarted({
            tx: tx as unknown as Db,
            caseId: input.caseId,
            toStatus: "building",
            actor: { type: "user", userId },
            reason: "attorney requested build",
          }),
        );
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({
            code: appErrorToTrpcCode(err.code),
            message: err.message,
          });
        }
        throw err;
      }

      // 6. Emit. AFTER the transition commits — if the emit fails, the
      // case is in `building` with `build_started_at` stamped, so the
      // watchdog catches it after 30m. Better than the alternative
      // (event sent, transition fails → duplicate parent run with
      // concurrency=1 dropping one).
      const { ids } = await inngest.send({
        name: "case/build.requested",
        data: { caseId: input.caseId, requestedBy: userId },
      });

      // Analytics + notification ETA share the same (visa_type,
      // doc_count) shape, so a single correlated read serves both. Doc
      // count is the "as-requested" snapshot; the build itself uses the
      // count at run time, which may differ.
      const [analyticsRow] = await db
        .select({
          visaType: cases.visaType,
          docCount: sql<number>`(
            select count(*)::int
            from ${caseDocuments}
            where ${caseDocuments.caseId} = ${cases.id}
              and ${caseDocuments.deletedAt} is null
          )`,
        })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);

      // Fan out the user-visible "build started" email. Sent on a
      // separate event from `case/build.requested` so the orchestrator
      // pipeline isn't coupled to email infra (PM.4 rationale). Failure
      // here is best-effort: the build is already queued, so a missed
      // email is preferable to surfacing TRPCError to the click path.
      try {
        await inngest.send({
          name: caseBuildStartedNotificationEvent.name,
          data: {
            caseId: input.caseId,
            etaMinutes: buildEtaMinutes(analyticsRow?.docCount ?? 0),
          },
        });
      } catch (err) {
        console.error("[notification.case.build_started] emit failed", {
          caseId: input.caseId,
          err,
        });
      }

      if (analyticsRow) {
        emitFromCtx(ctx, {
          name: "case.build_requested",
          properties: {
            case_id: input.caseId,
            visa_type: analyticsRow.visaType,
            document_count: analyticsRow.docCount,
          },
        });
      }

      return { ok: true as const, eventId: ids[0] ?? null };
    }),

  archive: protectedProcedure
    .input(ArchiveInput)
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;

      // Authorize via the user-scoped tx (RLS engaged). If the caller
      // can't see the case, RLS returns no row → NOT_FOUND. We pull
      // `status` here too so the analytics emit can report the
      // pre-archive state without a second round-trip.
      const [authzCheck] = await db
        .select({ id: cases.id, status: cases.status })
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
        const archivedAt = new Date();
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
            .set({ deletedAt: archivedAt })
            .where(eq(cases.id, input.caseId));
        });
        emitFromCtx(ctx, {
          name: "case.archived",
          properties: {
            case_id: input.caseId,
            prior_status: authzCheck.status,
          },
        });
        // Best-effort archive notification. ISO stamped from the same
        // wall clock the DB used for `deleted_at` so the email matches
        // the audit trail down to the millisecond, even if the listener
        // runs minutes later.
        try {
          await inngest.send({
            name: caseArchivedNotificationEvent.name,
            data: {
              caseId: input.caseId,
              archivedAt: archivedAt.toISOString(),
            },
          });
        } catch (err) {
          console.error("[notification.case.archived] emit failed", {
            caseId: input.caseId,
            err,
          });
        }
        return { ok: true as const };
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({ code: appErrorToTrpcCode(err.code), message: err.message });
        }
        throw err;
      }
    }),

  // ── Stage 11 β — case dashboards ──────────────────────────────────

  /**
   * Per-criterion exhibit count + strength rating for the Overview
   * Evidence-strength card. RLS-engaged via `ctx.db`. Returns
   * `visaSupported: false` for visas without a taxonomy yet so the UI
   * renders an `EmptyState` instead of an empty grid.
   */
  criteriaCoverage: protectedProcedure
    .input(GetInput)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ visaType: cases.visaType })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }
      return await computeCriteriaCoverage({
        db: ctx.db,
        caseId: input.caseId,
        visaType: row.visaType,
      });
    }),

  /**
   * Required-documents checklist for the Documents right rail. Each
   * item carries `present: boolean` (≥ minCount documents of the
   * matching type uploaded) plus the actual count so the UI can show
   * `2 of 3` for partial progress.
   */
  requiredDocsCoverage: protectedProcedure
    .input(GetInput)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ visaType: cases.visaType })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }
      const required = requiredDocsFor(row.visaType);
      if (required.length === 0) {
        return { visaSupported: false as const, items: [] };
      }
      // Pull every live document's type once; tally per documentType.
      const docs = await ctx.db
        .select({ documentType: caseDocuments.documentType })
        .from(caseDocuments)
        .where(
          and(
            eq(caseDocuments.caseId, input.caseId),
            isNull(caseDocuments.deletedAt),
          ),
        );
      const counts = new Map<string, number>();
      for (const d of docs) {
        counts.set(d.documentType, (counts.get(d.documentType) ?? 0) + 1);
      }
      return {
        visaSupported: true as const,
        items: required.map((r) => {
          const count = r.docType ? (counts.get(r.docType) ?? 0) : 0;
          const min = r.minCount ?? 1;
          return {
            key: r.key,
            label: r.label,
            criterion: r.criterion ?? null,
            count,
            minCount: min,
            // `present`: the auto-tick. `null` when the required doc
            // has no enum mapping (passport bio, I-94 — manual gate).
            present: r.docType === null ? null : count >= min,
            phase: r.phase ?? "pre_build",
          };
        }),
      };
    }),

  /**
   * Storage usage for the Documents StorageCard. Aggregate over
   * `case_documents.size_bytes`; per-case cap exposed as a constant
   * so the UI's progress-bar threshold lives in one place.
   */
  storageUsage: protectedProcedure
    .input(GetInput)
    .query(async ({ ctx, input }) => {
      const [authz] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!authz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }
      const [agg] = await ctx.db
        .select({
          // postgres-js returns sum(bigint) as a string — coerce via bn().
          totalBytes: sql<bigint>`coalesce(sum(${caseDocuments.sizeBytes}), 0)::bigint`,
          docCount: sql<number>`count(*)::int`,
        })
        .from(caseDocuments)
        .where(
          and(
            eq(caseDocuments.caseId, input.caseId),
            isNull(caseDocuments.deletedAt),
          ),
        );
      return {
        usedBytes: bn(agg?.totalBytes),
        documentCount: agg?.docCount ?? 0,
        capBytes: BigInt(PER_CASE_STORAGE_BYTES),
      };
    }),

  /**
   * Package pre-flight gates. Returns one row per gate the package
   * page renders + an aggregate `allOk` so the Download CTA can be
   * disabled in a single boolean. RLS-engaged via `ctx.db`.
   */
  preflight: protectedProcedure
    .input(GetInput)
    .query(async ({ ctx, input }) => {
      try {
        return await computePreflight({ db: ctx.db, caseId: input.caseId });
      } catch (err) {
        if (err instanceof AppError) {
          throw new TRPCError({
            code: appErrorToTrpcCode(err.code),
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Persist the attorney's drag-to-reorder choice for the package
   * assembly. Keys are `outputType:subgroupKey` (or just `outputType`
   * for unsubgrouped) — type-stable across regenerates, unlike output
   * ids. Authz via RLS-engaged read; the UPDATE runs through ownerDb
   * (cases UPDATE policy gates on `user_in_case`, which would reject
   * the `app_user` write — the read above is the gate).
   */
  setPackageOrder: attorneyProcedure
    .input(
      z.object({
        caseId: z.uuid(),
        orderedKeys: z.array(z.string().min(1).max(120)).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [authz] = await ctx.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!authz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "case not found" });
      }
      const value = input.orderedKeys.length > 0 ? input.orderedKeys : null;
      await ownerDb
        .update(cases)
        .set({ packageOrder: value })
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)));
      return { ok: true as const, orderedKeys: value ?? [] };
    }),
});

