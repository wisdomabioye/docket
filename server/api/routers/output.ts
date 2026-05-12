import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  caseDocuments,
  caseOutputs,
  cases,
  outputTypeEnum,
} from "@/server/db/schema";
import type { OutputType } from "@/server/services/computer/types";
import { db as ownerDb, type Db } from "@/server/db/client";
import {
  attorneyProcedure,
  protectedProcedure,
  router,
} from "@/server/api/trpc";
import {
  approveOutput,
  clearOutputDraft,
  getCurrentOutputsForList,
  getOutputVersionHistory,
  restoreOutputVersion,
  saveOutputDraft,
  setOutputApproval,
  summarizeOutputApprovals,
  updateOutputContent,
} from "@/server/services/output";
import {
  compileFullPackagePdf,
  renderPerOutputPdf,
} from "@/server/services/pdf";
import { mdToSafeHtml } from "@/lib/markdown";
import {
  isInternalOutputType,
  isStructuredOutputType,
} from "@/lib/output-types";
import { ExhibitIndexSchema } from "@/server/services/computer/prompts/exhibit-index";
import { rateLimit } from "@/server/services/ratelimit";
import { inngest } from "@/server/jobs/client";
import {
  outputApprovedNotificationEvent,
  packageReadyNotificationEvent,
} from "@/server/services/email/notifications";
import { AppError, appErrorToTrpcCode } from "@/lib/errors";
import { emitFromCtx } from "@/server/services/analytics/emit";
import {
  assertOutputMutationAllowed,
  type CaseStatus,
  type LockableOutputMutation,
} from "@/lib/case-status";
import {
  reconcileCaseStatus,
  type ReconcileResult,
  type ReconcileTrigger,
} from "@/server/services/cases/reconcile-status";
import {
  isUserCaseParticipant,
  visibleCaseIds,
} from "@/server/services/cases/visibility";

/**
 * Stage 08 output review router. Every mutation goes through
 * `attorneyProcedure` (active-attorney profile required); every query
 * uses `protectedProcedure` so reads work even for an attorney whose
 * profile is suspended (read-only mode).
 *
 * RLS: queries run on `ctx.db` (user-scoped tx); writes that need to
 * touch `case_events` (via `transitionCase` indirectly) or auto-bypass
 * RLS use `ownerDb`.
 *
 * Mutation matrix:
 *   - update     → un-approve required (service throws CONFLICT)
 *   - regenerate → auto-unapprove THEN emit event (no race window)
 *   - approve / unapprove → flip in single tx
 *   - restoreVersion → copy prior content into a new is_current row
 *   - downloadPdf / downloadPackage → render fresh, return signed URL
 */

const ListInput = z.object({ caseId: z.uuid() });
const GetInput = z.object({ outputId: z.uuid() });

// Per-case approval tally for the dashboard's case list. Cap at 200 ids
// so a malicious caller can't hit the DB with a huge IN-list.
const SummarizeInput = z.object({
  caseIds: z.array(z.uuid()).max(200),
});
const ListVersionsInput = z.object({
  caseId: z.uuid(),
  outputType: z.enum(outputTypeEnum.enumValues),
  subgroupKey: z.string().min(1).max(200).optional(),
});

// Markdown content cap: 200_000 chars (~50 pages). Stage 07 prompt
// cap is ~12k chars; an attorney's edits adding context shouldn't
// exceed an order of magnitude beyond that.
const UpdateInput = z.object({
  outputId: z.uuid(),
  content: z.string().min(1).max(200_000),
});

/**
 * Typed-payload commit for output types whose canonical `content` is
 * JSON, not markdown. The discriminator is `outputType`; each branch
 * carries the validated typed object. The router serializes via
 * `JSON.stringify` and writes through the same `updateOutputContent`
 * service that the prose path uses, so the version graph + draft
 * flush + approve mechanics are identical.
 *
 * `output.update` rejects these output types so a stale client can't
 * smuggle markdown into the JSON column and silently break the
 * downstream `_context.ts` `JSON.parse(content)` path.
 */
const UpdateStructuredInput = z.discriminatedUnion("outputType", [
  z.object({
    outputType: z.literal("exhibit_index"),
    outputId: z.uuid(),
    payload: ExhibitIndexSchema,
  }),
]);

// Drafts allow `""` (the user cleared the editor in mid-edit) — see
// `saveOutputDraft` JSDoc. Same length cap as commits.
const SaveDraftInput = z.object({
  outputId: z.uuid(),
  content: z.string().max(200_000),
});

const ClearDraftInput = z.object({ outputId: z.uuid() });

const ApproveInput = z.object({
  outputId: z.uuid(),
  notes: z.string().max(2000).optional(),
});

const UnapproveInput = z.object({ outputId: z.uuid() });

const RegenerateInput = z.object({
  outputId: z.uuid(),
  guidance: z.string().min(1).max(5000).optional(),
});

const RestoreVersionInput = z.object({ fromVersionId: z.uuid() });

const DownloadPdfInput = z.object({ outputId: z.uuid() });
const DownloadPackageInput = z.object({ caseId: z.uuid() });

/** Helper: normalize errors to TRPC codes. Used at the boundary of
 *  every mutation to keep error handling consistent (and so tests can
 *  assert on the typed code field). */
function rethrowAsTrpc(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  if (err instanceof AppError) {
    throw new TRPCError({
      code: appErrorToTrpcCode(err.code),
      message: err.message,
    });
  }
  throw err;
}

/** RLS gate: confirms the caller can see the output via ctx.db.
 *  Returns the caseId (needed by mutations that pivot to ownerDb)
 *  plus `caseStatus` for the post-package mutation lock check.
 *  NOT_FOUND covers both "doesn't exist" and "not your case" so
 *  there's no existence oracle. RLS on `cases` and `case_outputs`
 *  share the same `user_in_case` participant policy (`0005_rls.sql`),
 *  so the JOIN is RLS-safe — same gate, no leakage. */
async function gateOutputAccess(args: {
  ctxDb: Db;
  outputId: string;
}): Promise<{
  caseId: string;
  outputType: OutputType;
  subgroupKey: string | null;
  caseStatus: CaseStatus;
}> {
  const [row] = await args.ctxDb
    .select({
      caseId: caseOutputs.caseId,
      outputType: caseOutputs.outputType,
      subgroupKey: caseOutputs.subgroupKey,
      caseStatus: cases.status,
    })
    .from(caseOutputs)
    .innerJoin(cases, eq(cases.id, caseOutputs.caseId))
    .where(
      and(eq(caseOutputs.id, args.outputId), isNull(caseOutputs.deletedAt)),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
  }
  return row;
}

/** Run `assertOutputMutationAllowed` and convert any AppError it
 *  throws into a TRPCError via the existing `rethrowAsTrpc` helper.
 *  Single conversion path for AppError → TRPCError across the file. */
function assertMutation(
  status: CaseStatus,
  mutation: LockableOutputMutation,
): void {
  try {
    assertOutputMutationAllowed(status, mutation);
  } catch (err) {
    rethrowAsTrpc(err);
  }
}

/** Post-tx analytics emit for a reconciler result. Fire-and-forget
 *  — analytics latency must not surface to the caller. Only emits
 *  on real transitions (`changed === true`); same-status no-ops are
 *  silent. Mirrors the `emitFromCtx` convention. */
function emitLifecycleTransition(
  ctx: Parameters<typeof emitFromCtx>[0],
  caseId: string,
  trigger: ReconcileTrigger,
  result: ReconcileResult,
): void {
  if (!result.changed) return;
  emitFromCtx(ctx, {
    name: "case.lifecycle_transition",
    properties: {
      case_id: caseId,
      from_status: result.from,
      to_status: result.to,
      trigger,
    },
  });
}

export const outputRouter = router({
  /**
   * Per-case approval tally for the dashboard. Filters the caller's
   * input down to cases they actively participate on before tallying
   * — admin RLS bypass (see `services/cases/visibility.ts`) would
   * otherwise let an admin see counts for every attorney's cases.
   *
   * Returns a plain object map so superjson serializes cleanly across
   * the wire — `Map` values are serializable but the Record shape is
   * easier to consume in client components.
   */
  summarize: protectedProcedure
    .input(SummarizeInput)
    .query(async ({ ctx, input }) => {
      const visible = await visibleCaseIds(ctx.db, input.caseIds, ctx.userId);
      const out: Record<string, { approved: number; total: number }> = {};
      if (visible.length === 0) return out;
      const tally = await summarizeOutputApprovals({
        db: ctx.db,
        caseIds: visible,
      });
      for (const [caseId, counts] of tally) out[caseId] = counts;
      return out;
    }),

  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    // Slim projection — the grid card view doesn't need full prose.
    // Application-layer participant gate; RLS stays as safety net.
    if (!(await isUserCaseParticipant(ctx.db, input.caseId, ctx.userId))) {
      return [];
    }
    return await getCurrentOutputsForList({
      db: ctx.db,
      caseId: input.caseId,
    });
  }),

  get: protectedProcedure.input(GetInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(caseOutputs)
      .where(
        and(eq(caseOutputs.id, input.outputId), isNull(caseOutputs.deletedAt)),
      )
      .limit(1);
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
    }
    // Application-layer participant gate. Indistinguishable from
    // "output not found" so admin sessions not on the case can't
    // infer existence.
    if (!(await isUserCaseParticipant(ctx.db, row.caseId, ctx.userId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
    }
    // Internal scaffolding types (e.g. evidence_plan) feed prompt
    // builders but aren't attorney-facing — return NOT_FOUND rather
    // than expose the JSON content via a direct-link bookmark.
    if (isInternalOutputType(row.outputType)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
    }
    return row;
  }),

  listVersions: protectedProcedure
    .input(ListVersionsInput)
    .query(async ({ ctx, input }) => {
      // Internal scaffolding types (e.g. evidence_plan) feed prompt
      // builders but aren't attorney-facing. Mirror `output.get`'s
      // NOT_FOUND so version-history metadata isn't reachable via a
      // direct procedure call either.
      if (isInternalOutputType(input.outputType)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "output not found" });
      }
      // Application-layer participant gate. RLS remains as a safety
      // net, but admin sessions bypass it on case_outputs.
      if (!(await isUserCaseParticipant(ctx.db, input.caseId, ctx.userId))) {
        return [];
      }
      return await getOutputVersionHistory({
        db: ctx.db,
        caseId: input.caseId,
        outputType: input.outputType,
        ...(input.subgroupKey !== undefined
          ? { subgroupKey: input.subgroupKey }
          : {}),
      });
    }),

  /**
   * Stage 11 W3 — save the editor's pending draft IN PLACE on the
   * current row, no new version, no `attorney_approved` change. The
   * editor's 3s debounce calls this; "Save version" goes through
   * `update` instead.
   *
   * Rate-limited at 120/min/user (see `ratelimit.ts` for rationale).
   * The service layer's idempotency check still drops no-op writes
   * even when the limiter is bypassed.
   */
  saveDraft: attorneyProcedure
    .input(SaveDraftInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;

      const rl = await rateLimit("output.saveDraft", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Auto-save rate limit reached (${rl.limit}/min). Pause editing for a moment.`,
        });
      }

      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      // saveDraft is conceptually a content edit — reuse the
      // `output.update` lock target. Same blast radius (typing into
      // a doomed buffer on a delivered case) and same error message
      // shape ("Cannot update outputs on a delivered case…").
      assertMutation(access.caseStatus, "output.update");
      // Defense in depth: structured-output types (exhibit_index)
      // store JSON in `content`. A markdown draft from a stale client
      // would silently corrupt the JSON contract that downstream
      // `_context.ts` parsers depend on.
      if (isStructuredOutputType(access.outputType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This output type does not accept markdown drafts — use the structured editor.",
        });
      }
      try {
        const { saved, transition } = await ownerDb.transaction(async (tx) => {
          const r = await saveOutputDraft({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            content: input.content,
          });
          // Trigger `output_edited`: first autosave on a `draft_ready`
          // case advances it to `in_review`. Subsequent autosaves
          // no-op in the reconciler (no rule for `in_review +
          // output_edited`). The tally is unchanged — drafts don't
          // touch `attorneyApproved`.
          const t = await reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_edited",
            actor: { type: "user", userId },
          });
          return { saved: r.saved, transition: t };
        });
        // Emit only when the service actually wrote — `saved=false`
        // means the draft was identical to the prior write (idempotent
        // no-op), so emitting it would inflate the autosave count.
        if (saved) {
          emitFromCtx(ctx, {
            name: "output.draft_saved",
            properties: {
              case_id: access.caseId,
              output_id: input.outputId,
              content_length: input.content.length,
            },
          });
        }
        emitLifecycleTransition(ctx, access.caseId, "output_edited", transition);
        return { ok: true as const, saved };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  /**
   * Stage 11 W3 — discard the pending draft. Used by the editor's
   * Cancel button. Idempotent: clearing an empty draft is a no-op.
   */
  clearDraft: attorneyProcedure
    .input(ClearDraftInput)
    .mutation(async ({ ctx, input }) => {
      await gateOutputAccess({ ctxDb: ctx.db, outputId: input.outputId });
      try {
        const r = await ownerDb.transaction(async (tx) =>
          clearOutputDraft({
            tx: tx as unknown as Db,
            outputId: input.outputId,
          }),
        );
        return { ok: true as const, cleared: r.cleared };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  update: attorneyProcedure
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      // RLS check — the user-scoped read fails fast for cross-attorney access.
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      assertMutation(access.caseStatus, "output.update");
      // Reject markdown commits on structured types — they go through
      // `output.updateStructured` so the JSON contract that
      // `_context.ts` depends on is preserved.
      if (isStructuredOutputType(access.outputType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This output type requires a structured payload — use updateStructured.",
        });
      }

      try {
        const { result, transition } = await ownerDb.transaction(async (tx) => {
          const r = await updateOutputContent({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            content: input.content,
            // Pre-render + sanitize so reads don't re-run marked.
            // Sanitization runs even though the content originates from
            // Tiptap (defense in depth — paste-from-Word can leak past
            // the editor's schema).
            contentHtml: mdToSafeHtml(input.content),
            attorneyId: userId,
          });
          // Trigger `output_edited`: drives `draft_ready → in_review`
          // on first save. `updateOutputContent` already rejects
          // approved parents server-side (CONFLICT), so the tally is
          // unchanged here — no other lifecycle edges fire.
          const t = await reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_edited",
            actor: { type: "user", userId },
          });
          return { result: r, transition: t };
        });
        emitFromCtx(ctx, {
          name: "output.version_saved",
          properties: {
            case_id: access.caseId,
            output_id: result.outputId,
            version: result.outputVersion,
          },
        });
        emitLifecycleTransition(ctx, access.caseId, "output_edited", transition);
        return {
          ok: true as const,
          outputId: result.outputId,
          outputVersion: result.outputVersion,
        };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  /**
   * Typed-payload commit for JSON-mode output types (currently
   * `exhibit_index`). The Zod discriminator validates the payload
   * shape; the router serializes via `JSON.stringify` and writes
   * through the same `updateOutputContent` service the prose path
   * uses, so the version graph + draft flush + approve mechanics are
   * shared. Drafts for structured types are out of scope until a
   * follow-up commit; for now Save is the only mutation path.
   */
  updateStructured: attorneyProcedure
    .input(UpdateStructuredInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      assertMutation(access.caseStatus, "output.update");
      // Defense in depth: cross-check that the input's discriminator
      // matches the row's actual `output_type`. Without this an
      // attacker who mints an `exhibit_index` payload but supplies the
      // outputId of a `personal_statement` row would corrupt that row
      // with stringified JSON.
      if (access.outputType !== input.outputType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `outputType mismatch: row is ${access.outputType}, payload is ${input.outputType}`,
        });
      }
      // FK integrity: every entry's `documentId` must reference a live
      // `case_documents` row in this case. RLS on `case_documents`
      // already filters cross-case access, so missing ids are either
      // (a) deleted between client load and save (race) or (b) a
      // stale/spoofed id. Reject with a list of the missing ids so the
      // client can highlight them and resync.
      if (input.outputType === "exhibit_index") {
        const docIds = Array.from(
          new Set(input.payload.entries.map((e) => e.documentId)),
        );
        if (docIds.length > 0) {
          const found = await ctx.db
            .select({ id: caseDocuments.id })
            .from(caseDocuments)
            .where(
              and(
                eq(caseDocuments.caseId, access.caseId),
                inArray(caseDocuments.id, docIds),
                isNull(caseDocuments.deletedAt),
              ),
            );
          const foundSet = new Set(found.map((r) => r.id));
          const missing = docIds.filter((id) => !foundSet.has(id));
          if (missing.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Exhibit index references ${missing.length} document${missing.length === 1 ? "" : "s"} that no longer exist on this case. Refresh the editor and remove the stale row${missing.length === 1 ? "" : "s"}.`,
            });
          }
        }
      }
      const serialized = JSON.stringify(input.payload);
      try {
        const { result, transition } = await ownerDb.transaction(async (tx) => {
          const r = await updateOutputContent({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            content: serialized,
            // Structured types render through the JSON→markdown
            // formatter at read time, not via a stored HTML cache.
            // `null` to keep `case_outputs.content_html` consistent
            // with "no pre-rendered HTML for this output".
            contentHtml: null,
            attorneyId: userId,
          });
          const t = await reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_edited",
            actor: { type: "user", userId },
          });
          return { result: r, transition: t };
        });
        emitFromCtx(ctx, {
          name: "output.version_saved",
          properties: {
            case_id: access.caseId,
            output_id: result.outputId,
            version: result.outputVersion,
          },
        });
        emitLifecycleTransition(ctx, access.caseId, "output_edited", transition);
        return {
          ok: true as const,
          outputId: result.outputId,
          outputVersion: result.outputVersion,
        };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  approve: attorneyProcedure
    .input(ApproveInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      // Approve is the one mutation excluded from the {delivered, filed}
      // lock — re-approving after a partial backslide is a normal
      // review path. Only `archived` rejects.
      assertMutation(access.caseStatus, "output.approve");

      try {
        // `approveOutput` flushes any pending draft into a new version
        // BEFORE setting `attorney_approved=true`, so the approval
        // always lands on what the user sees on screen — not on a
        // stale baseline that the autosave hadn't yet committed
        // (W3 + W4.3 contract).
        const { result, transition } = await ownerDb.transaction(async (tx) => {
          const r = await approveOutput({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            attorneyId: userId,
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          });
          // Reconciler reads the post-flip tally inside the same tx
          // (case-row FOR UPDATE serializes concurrent approves) so
          // the `allApproved` answer can't go stale between flip and
          // notification fan-out — closes the prior race window where
          // two parallel approves could each read the post-flip state
          // independently.
          const t = await reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_approval_changed",
            actor: { type: "user", userId },
          });
          return { result: r, transition: t };
        });
        emitFromCtx(ctx, {
          name: "output.approved",
          properties: {
            case_id: access.caseId,
            // Use the post-flush id — when a draft was flushed this is
            // the FRESH row that got the approval stamp, not the old one.
            output_id: result.approvedOutputId,
            draft_flushed: result.draftFlushed,
          },
        });
        emitLifecycleTransition(
          ctx,
          access.caseId,
          "output_approval_changed",
          transition,
        );

        // Notification fan-out. Two events may fire:
        //   1. `output.approved` — always, one per approve click.
        //   2. `package.ready` — only when the post-flip tally is
        //      "every current output approved". Re-firing on a
        //      subsequent unapprove → re-approve is acceptable: each
        //      event represents a fresh "package is whole again" state.
        // `transition.allApproved` is the answer the reconciler read
        // under the case-row lock — no need for a second tally query.
        const events: Parameters<typeof inngest.send>[0] = [
          {
            name: outputApprovedNotificationEvent.name,
            data: { caseId: access.caseId, outputId: result.approvedOutputId },
          },
        ];
        if (transition.allApproved) {
          events.push({
            name: packageReadyNotificationEvent.name,
            data: { caseId: access.caseId },
          });
        }
        try {
          await inngest.send(events);
        } catch (err) {
          console.error("[notification.output.approved] emit failed", {
            caseId: access.caseId,
            err,
          });
        }

        return {
          ok: true as const,
          // When draft was flushed, `approvedOutputId` is the NEW
          // version's id — client navigates to it so the URL keeps
          // pointing at the current row.
          approvedOutputId: result.approvedOutputId,
          draftFlushed: result.draftFlushed,
        };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  unapprove: attorneyProcedure
    .input(UnapproveInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      assertMutation(access.caseStatus, "output.unapprove");

      try {
        const transition = await ownerDb.transaction(async (tx) => {
          await setOutputApproval({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            approved: false,
            attorneyId: userId,
          });
          // Trigger `output_approval_changed`: drives the
          // `approved → in_review` backslide via the reconciler's
          // `!allApproved` predicate. From `in_review` the rule is
          // a no-op (already in the right place).
          return reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_approval_changed",
            actor: { type: "user", userId },
          });
        });
        emitLifecycleTransition(
          ctx,
          access.caseId,
          "output_approval_changed",
          transition,
        );
        return { ok: true as const };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  regenerate: attorneyProcedure
    .input(RegenerateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;

      const rl = await rateLimit("output.regenerate", userId);
      if (!rl.success) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Regenerate rate limit reached (${rl.limit}/hour). Try again later.`,
        });
      }

      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      assertMutation(access.caseStatus, "output.regenerate");

      // Auto-un-approve in the SAME tx as the event-emit-trigger so the
      // approval state can't go stale during the regen window. Idempotent
      // on already-unapproved rows (service returns `changed: false`).
      let transition: ReconcileResult;
      try {
        transition = await ownerDb.transaction(async (tx) => {
          await setOutputApproval({
            tx: tx as unknown as Db,
            outputId: input.outputId,
            approved: false,
            attorneyId: userId,
          });
          return reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_approval_changed",
            actor: { type: "user", userId },
          });
        });
      } catch (err) {
        rethrowAsTrpc(err);
      }
      emitLifecycleTransition(
        ctx,
        access.caseId,
        "output_approval_changed",
        transition,
      );

      // Emit AFTER the unapprove commits — order matters: if emit
      // failed before the unapprove, the case would have a stale-
      // approved current row while a regenerate ran. The reverse (emit
      // then unapprove fail) just means the regen runs but the row
      // stays approved; the regen-output handler will create a fresh
      // (unapproved) version anyway.
      const { ids } = await inngest.send({
        name: "case/output.regenerate.requested",
        data: {
          caseId: access.caseId,
          outputId: input.outputId,
          ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
        },
      });
      return { ok: true as const, eventId: ids[0] ?? null };
    }),

  restoreVersion: attorneyProcedure
    .input(RestoreVersionInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.fromVersionId,
      });
      assertMutation(access.caseStatus, "output.restoreVersion");

      try {
        const { result, transition } = await ownerDb.transaction(async (tx) => {
          const r = await restoreOutputVersion({
            tx: tx as unknown as Db,
            fromVersionId: input.fromVersionId,
            attorneyId: userId,
          });
          // Trigger `output_approval_changed` (NOT `output_edited`):
          // restoreVersion calls `saveOutputVersion` which inserts
          // a new current row with `attorneyApproved=false` by
          // default. Restoring from `approved` therefore drops the
          // tally; only `output_approval_changed`'s rules catch the
          // backslide. ADR-006 Step 4 amendment.
          const t = await reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: access.caseId,
            trigger: "output_approval_changed",
            actor: { type: "user", userId },
          });
          return { result: r, transition: t };
        });
        emitLifecycleTransition(
          ctx,
          access.caseId,
          "output_approval_changed",
          transition,
        );
        return {
          ok: true as const,
          outputId: result.outputId,
          outputVersion: result.outputVersion,
        };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  downloadPdf: attorneyProcedure
    .input(DownloadPdfInput)
    .mutation(async ({ ctx, input }) => {
      const access = await gateOutputAccess({
        ctxDb: ctx.db,
        outputId: input.outputId,
      });
      try {
        const result = await renderPerOutputPdf({
          db: ctx.db,
          caseId: access.caseId,
          outputId: input.outputId,
        });
        return { url: result.url, bytes: result.bytes };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),

  downloadPackage: attorneyProcedure
    .input(DownloadPackageInput)
    .mutation(async ({ ctx, input }) => {
      // RLS gate via a current-outputs read. If the caller can't see
      // the case, getCurrentOutputs returns an empty array — and
      // compile rejects with BAD_REQUEST. Defense in depth.
      //
      // Order: compile FIRST (slow — render + upload), then a SHORT
      // bookkeeping tx (timestamp set + reconcile). Holding a tx
      // around the PDF render would lock the case row for 5-30s.
      // If compile fails (e.g. not all approved), no tx work, no
      // transition. If compile succeeds but the bookkeeping tx fails,
      // the PDF is orphaned in storage — acceptable cost for forward
      // compatibility (re-download retries the bookkeeping).
      try {
        const result = await compileFullPackagePdf({
          db: ctx.db,
          caseId: input.caseId,
        });
        const transition = await ownerDb.transaction(async (tx) => {
          // Idempotent timestamp set. The WHERE clause skips the
          // UPDATE entirely on already-delivered cases so re-downloads
          // don't churn `updated_at` / `row_revision`. `coalesce`
          // preserves the earlier wall-clock when one column is set
          // and the other isn't (a state we should never reach in
          // practice, but cheap to handle).
          await tx
            .update(cases)
            .set({
              packageCompiledAt: sql`coalesce(${cases.packageCompiledAt}, now())`,
              deliveredAt: sql`coalesce(${cases.deliveredAt}, now())`,
            })
            .where(
              and(
                eq(cases.id, input.caseId),
                or(
                  isNull(cases.packageCompiledAt),
                  isNull(cases.deliveredAt),
                ),
              ),
            );
          return reconcileCaseStatus({
            tx: tx as unknown as Db,
            caseId: input.caseId,
            trigger: "package_delivered",
            actor: { type: "user", userId: ctx.userId },
          });
        });
        emitFromCtx(ctx, {
          name: "package.exported",
          properties: {
            case_id: input.caseId,
            // The package PDF has no separate DB row — its identity IS
            // the storage key (`cases/<id>/pdf/package-<ts>.pdf`),
            // which is stable per-export and useful for de-dup analytics.
            package_id: result.key,
            size_bytes: result.bytes,
          },
        });
        emitLifecycleTransition(
          ctx,
          input.caseId,
          "package_delivered",
          transition,
        );
        return { url: result.url, bytes: result.bytes };
      } catch (err) {
        rethrowAsTrpc(err);
      }
    }),
});
