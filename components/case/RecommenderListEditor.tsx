"use client";

import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/react";
import { formatTrpcError } from "@/lib/trpc/format-error";
import { Card, EmptyState } from "@/components/ui";
import {
  RecommenderInputSchema,
  type RecommenderInput,
} from "@/server/db/schema/zod/recommender";
import type { VisaType } from "@/lib/constants";
import { visaCriteriaConfig } from "@/lib/visa-criteria";

/**
 * Per-case recommender roster editor. Lives inside the IntakeWizard's
 * "Recommenders" section and is also re-usable on its own.
 *
 * Design constraints:
 *   - Source of truth is the server (`recommender.list`); local state
 *     only tracks the in-progress add/edit form to avoid mid-edit
 *     refetch flicker.
 *   - Validation uses `RecommenderInputSchema` — same Zod schema the
 *     tRPC router consumes, so the form can never submit a payload the
 *     server would reject for shape reasons.
 *   - Locked mode disables every interactive element. Mirrors the
 *     IntakeWizard's lock semantics so a single status check controls
 *     both.
 *   - Mutation `onSuccess` invalidates the list query — the server is
 *     authoritative on `displayOrder` after `create`.
 */

export type RecommenderListEditorProps = {
  caseId: string;
  locked: boolean;
  /** Visa type for the case. Drives the recommender minimum and the
   *  copy that surfaces it. Passed through from the page (sourced from
   *  `case.get`) — looked up in `lib/visa-criteria.ts` here so the
   *  editor renders correctly even if the parent doesn't know the
   *  per-visa numbers. */
  visaType: VisaType;
};

type DraftMode =
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "editing"; recommenderId: string };

const EMPTY_DRAFT: RecommenderInput = {
  fullName: "",
  relationship: "",
  titleOrg: null,
  email: null,
  guidance: null,
};

export function RecommenderListEditor(
  props: RecommenderListEditorProps,
): React.ReactElement {
  const utils = trpc.useUtils();
  const listQuery = trpc.recommender.list.useQuery({ caseId: props.caseId });

  const invalidate = useCallback(
    () => utils.recommender.list.invalidate({ caseId: props.caseId }),
    [utils, props.caseId],
  );

  const create = trpc.recommender.create.useMutation({
    onSuccess: () => invalidate(),
  });
  const update = trpc.recommender.update.useMutation({
    onSuccess: () => invalidate(),
  });
  const remove = trpc.recommender.remove.useMutation({
    onSuccess: () => invalidate(),
  });

  const [mode, setMode] = useState<DraftMode>({ kind: "idle" });
  const [draft, setDraft] = useState<RecommenderInput>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);

  const list = listQuery.data ?? [];
  const busy = create.isPending || update.isPending || remove.isPending;

  // Per-visa recommender contract:
  //   - Config present + minRecommenders defined → drive empty-state
  //     copy, "X of Y added" counter, and a "below recommended" chip.
  //   - Config present + minRecommenders undefined → neutral copy,
  //     no counter or chip (visa has no formal minimum).
  //   - Config null (visa exists in the enum but isn't supported by
  //     Phase 1 — e.g. EB-1A pre-launch) → neutral copy + dev warn.
  //     Phase 1 gates `case.create` to supported visas so this branch
  //     is theoretically unreachable in prod; the warn surfaces it
  //     during the next visa rollout if a config is missed.
  const visaConfig = visaCriteriaConfig(props.visaType);
  // Dev-only warn when the editor renders for a visa with no config —
  // gated to once per visaType change so a re-render storm doesn't
  // spam the console. Production builds never log; Phase 1 also gates
  // `case.create` to supported visas, so this branch should be
  // unreachable in prod regardless.
  useEffect(() => {
    if (visaConfig === null && process.env.NODE_ENV !== "production") {
      console.warn(
        `[RecommenderListEditor] No visa config for "${props.visaType}". Falling back to neutral copy. Add a config in lib/visa-criteria.ts.`,
      );
    }
  }, [props.visaType, visaConfig]);
  const minRecommenders = visaConfig?.minRecommenders;
  const recommenderCount = list.length;
  const belowMinimum =
    minRecommenders !== undefined && recommenderCount < minRecommenders;
  const emptyStateSubtitle =
    minRecommenders !== undefined
      ? `Add at least ${formatCount(minRecommenders)} letter-writer${
          minRecommenders === 1 ? "" : "s"
        } (${props.visaType} minimum). The build pipeline drafts one recommendation letter per recommender.`
      : "Add letter-writers for this case. The build pipeline drafts one recommendation letter per recommender.";

  const submitError =
    draftError ??
    formatTrpcError(create.error) ??
    formatTrpcError(update.error);

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    setMode({ kind: "adding" });
  }

  function startEdit(r: (typeof list)[number]) {
    setDraft({
      fullName: r.fullName,
      relationship: r.relationship,
      titleOrg: r.titleOrg ?? null,
      email: r.email ?? null,
      guidance: r.guidance ?? null,
    });
    setDraftError(null);
    setMode({ kind: "editing", recommenderId: r.id });
  }

  function cancelDraft() {
    setMode({ kind: "idle" });
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
  }

  async function submitDraft() {
    const parsed = RecommenderInputSchema.safeParse(draft);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setDraftError(first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
      return;
    }
    setDraftError(null);
    if (mode.kind === "adding") {
      await create.mutateAsync({ caseId: props.caseId, data: parsed.data });
    } else if (mode.kind === "editing") {
      await update.mutateAsync({
        recommenderId: mode.recommenderId,
        patch: parsed.data,
      });
    }
    setMode({ kind: "idle" });
    setDraft(EMPTY_DRAFT);
  }

  async function removeRecommender(recommenderId: string) {
    await remove.mutateAsync({ recommenderId });
    if (mode.kind === "editing" && mode.recommenderId === recommenderId) {
      cancelDraft();
    }
  }

  return (
    <div className="space-y-4" data-component="recommender-list-editor">
      {minRecommenders !== undefined && list.length > 0 ? (
        <div
          className="flex items-center gap-2 text-xs"
          data-component="recommender-count"
        >
          <span
            className="mono"
            style={{ color: "var(--ink-muted)" }}
          >
            {recommenderCount} of {minRecommenders} added
          </span>
          {belowMinimum ? (
            <span
              role="status"
              className="mono rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "var(--danger-soft, rgba(177,51,14,0.1))",
                color: "var(--danger, #b1330e)",
              }}
            >
              Below {props.visaType} minimum
            </span>
          ) : null}
        </div>
      ) : null}
      {listQuery.isLoading ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </p>
      ) : list.length === 0 && mode.kind !== "adding" ? (
        <EmptyState title="No recommenders yet" subtitle={emptyStateSubtitle} />
      ) : (
        <ul className="space-y-3">
          {list.map((r) => {
            const editing =
              mode.kind === "editing" && mode.recommenderId === r.id;
            return (
              <li key={r.id}>
                {editing ? (
                  <RecommenderForm
                    draft={draft}
                    onChange={setDraft}
                    onSubmit={submitDraft}
                    onCancel={cancelDraft}
                    submitLabel="Save"
                    busy={busy}
                    locked={props.locked}
                  />
                ) : (
                  <RecommenderRow
                    recommender={r}
                    locked={props.locked || busy}
                    onEdit={() => startEdit(r)}
                    onRemove={() => removeRecommender(r.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mode.kind === "adding" ? (
        <RecommenderForm
          draft={draft}
          onChange={setDraft}
          onSubmit={submitDraft}
          onCancel={cancelDraft}
          submitLabel="Add recommender"
          busy={busy}
          locked={props.locked}
        />
      ) : (
        <button
          type="button"
          onClick={startAdd}
          disabled={props.locked || busy}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
        >
          + Add recommender
        </button>
      )}

      {submitError ? (
        <p
          role="alert"
          className="whitespace-pre-line rounded-md border p-3 text-sm"
          style={{
            borderColor: "var(--danger, #b1330e)",
            color: "var(--danger, #b1330e)",
            background: "var(--danger-soft, rgba(177,51,14,0.06))",
          }}
        >
          {submitError}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

type RecommenderRowProps = {
  recommender: {
    id: string;
    fullName: string;
    relationship: string;
    titleOrg: string | null;
    email: string | null;
    guidance: string | null;
  };
  locked: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

function RecommenderRow(props: RecommenderRowProps): React.ReactElement {
  const r = props.recommender;
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            {r.fullName}
          </p>
          {r.titleOrg ? (
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {r.titleOrg}
            </p>
          ) : null}
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {r.relationship}
          </p>
          {r.email ? (
            <p className="mono text-[11px]" style={{ color: "var(--ink-muted)" }}>
              {r.email}
            </p>
          ) : null}
        </div>
        {!props.locked ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={props.onEdit}
              className="rounded-md border px-2 py-1 text-xs"
              style={{ borderColor: "var(--border, rgba(0,0,0,0.15))" }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={props.onRemove}
              className="rounded-md border px-2 py-1 text-xs"
              style={{
                borderColor: "var(--danger, #b1330e)",
                color: "var(--danger, #b1330e)",
              }}
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

type RecommenderFormProps = {
  draft: RecommenderInput;
  onChange: (next: RecommenderInput) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
  locked: boolean;
};

function RecommenderForm(props: RecommenderFormProps): React.ReactElement {
  const inputClass =
    "w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60";
  const inputStyle = {
    borderColor: "var(--border, rgba(0,0,0,0.15))",
    background: "var(--surface, white)",
    color: "var(--ink)",
  } as const;

  function set<K extends keyof RecommenderInput>(
    key: K,
    value: RecommenderInput[K],
  ) {
    props.onChange({ ...props.draft, [key]: value });
  }

  // For optional text fields, an empty input means "clear" → null.
  function setNullable(key: "titleOrg" | "email" | "guidance", value: string) {
    const trimmed = value.trim();
    set(key, trimmed.length === 0 ? null : value);
  }

  return (
    <Card>
      <div className="space-y-3">
        <Field
          label="Full name"
          value={props.draft.fullName}
          onChange={(v) => set("fullName", v)}
          disabled={props.locked || props.busy}
          inputClass={inputClass}
          inputStyle={inputStyle}
        />
        <Field
          label="Relationship to beneficiary"
          hint="e.g. PhD advisor, co-author on three publications, hiring manager."
          value={props.draft.relationship}
          onChange={(v) => set("relationship", v)}
          disabled={props.locked || props.busy}
          inputClass={inputClass}
          inputStyle={inputStyle}
        />
        <Field
          label="Title and organisation (optional)"
          hint='e.g. "Director, MIT Media Lab".'
          value={props.draft.titleOrg ?? ""}
          onChange={(v) => setNullable("titleOrg", v)}
          disabled={props.locked || props.busy}
          inputClass={inputClass}
          inputStyle={inputStyle}
        />
        <Field
          label="Email (optional)"
          type="email"
          value={props.draft.email ?? ""}
          onChange={(v) => setNullable("email", v)}
          disabled={props.locked || props.busy}
          inputClass={inputClass}
          inputStyle={inputStyle}
        />
        <Field
          label="Letter guidance (optional)"
          hint="Anything specific to emphasize in this recommender's letter."
          textarea
          value={props.draft.guidance ?? ""}
          onChange={(v) => setNullable("guidance", v)}
          disabled={props.locked || props.busy}
          inputClass={inputClass}
          inputStyle={inputStyle}
        />

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.busy}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border, rgba(0,0,0,0.15))" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.locked || props.busy}
            className="rounded-md border px-3 py-1.5 text-sm font-medium text-[var(--cream)] disabled:opacity-50"
            style={{ borderColor: "var(--ink)", background: "var(--ink)" }}
          >
            {props.busy ? "Saving…" : props.submitLabel}
          </button>
        </div>
      </div>
    </Card>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  hint?: string;
  type?: string;
  textarea?: boolean;
  inputClass: string;
  inputStyle: React.CSSProperties;
};

function Field(props: FieldProps): React.ReactElement {
  const id = `rec-${slug(props.label)}`;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-medium"
        style={{ color: "var(--ink)" }}
      >
        {props.label}
      </label>
      {props.textarea ? (
        <textarea
          id={id}
          rows={4}
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className={props.inputClass}
          style={props.inputStyle}
        />
      ) : (
        <input
          id={id}
          type={props.type ?? "text"}
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className={props.inputClass}
          style={props.inputStyle}
        />
      )}
      {props.hint ? (
        <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Spell small numbers for prose copy ("at least three letter-writers")
 *  while keeping arithmetic-relevant numbers digit-form ("3 of 3
 *  added"). Falls back to digits for unusual values. */
function formatCount(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
  return n >= 0 && n < words.length ? words[n]! : String(n);
}
