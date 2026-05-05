"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import { APP_ROUTES } from "@/config";
import { Card, EmptyState } from "@/components/ui";
import type { BeneficiaryData } from "@/server/db/schema/zod/beneficiary";
import { RecommenderListEditor } from "./RecommenderListEditor";

/**
 * Stage 11 γ multi-section intake wizard. Replaces the old single-page
 * `IntakeForm` with a sectioned UI, but persistence is unchanged: the
 * `BeneficiaryDataSchema` stays flat, every section save calls the
 * existing `case.updateBeneficiary` shallow-merge mutation.
 *
 * Sections are a UI grouping, not a schema concept. URL state
 * (`?section=...`) drives which section is active so back/forward
 * navigation works and a deep-link to a specific section is shareable.
 *
 * Auto-save: each input commits to the parent state on every keystroke
 * (cheap), and an idle-debounced save fires the mutation 800ms after
 * the last edit (expensive). Save also fires on section change so the
 * user never loses work moving between sections.
 *
 * `locked` mode (status past `documents_pending`): every input is
 * disabled, no save fires, footer shows the lock notice. Same gate
 * the old `IntakeForm` enforced.
 */

// ─────────────────────────────────────────────────────────────────────
// Types + section catalogue
// ─────────────────────────────────────────────────────────────────────

type FieldKey = keyof BeneficiaryData;

type FieldDef = {
  key: FieldKey;
  label: string;
  control: "text" | "date" | "number" | "textarea" | "email";
  hint?: string;
};

/** A wizard section is either a `fields` group (data merged into
 *  `beneficiary_data`) or a custom UI block (currently just the
 *  recommenders editor, which writes to its own table). The
 *  discriminator keeps SectionNav's filled/total counter type-safe
 *  and keeps the renderer a small switch, not a chain of optionals. */
type FieldsSectionDef = {
  kind: "fields";
  key: string;
  label: string;
  blurb: string;
  fields: ReadonlyArray<FieldDef>;
};

type RecommendersSectionDef = {
  kind: "recommenders";
  key: string;
  label: string;
  blurb: string;
};

type SectionDef = FieldsSectionDef | RecommendersSectionDef;

const SECTIONS: ReadonlyArray<SectionDef> = [
  {
    kind: "fields",
    key: "profile",
    label: "Profile",
    blurb:
      "Beneficiary's identity. Used in every prompt's lead and on the package cover sheet.",
    fields: [
      { key: "fullName", label: "Full name", control: "text" },
      { key: "dateOfBirth", label: "Date of birth", control: "date" },
      { key: "nationality", label: "Nationality", control: "text" },
      {
        key: "currentLocation",
        label: "Current location",
        control: "text",
        hint: "City, country (or US state if currently in the US).",
      },
    ],
  },
  {
    kind: "fields",
    key: "practice",
    label: "Practice",
    blurb:
      "What the beneficiary actually does. Anchors the criteria narrative.",
    fields: [
      { key: "occupation", label: "Occupation / title", control: "text" },
      {
        key: "field",
        label: "Field of endeavour",
        control: "text",
        hint: "E.g. computational biology, art-direction for film.",
      },
      {
        key: "yearsActive",
        label: "Years in the field",
        control: "number",
      },
    ],
  },
  {
    kind: "fields",
    key: "filing",
    label: "Filing target",
    blurb:
      "Filing logistics. The wizard auto-saves on every keystroke; come back later if anything is unknown.",
    fields: [
      {
        key: "targetFilingDate",
        label: "Target filing date",
        control: "date",
        hint: "When you plan to send the package to USCIS.",
      },
      { key: "email", label: "Beneficiary email", control: "email" },
    ],
  },
  {
    kind: "recommenders",
    key: "recommenders",
    label: "Recommenders",
    blurb:
      "Letter-writers for this case. The build pipeline drafts one recommendation letter per recommender — minimum three for O-1A.",
  },
  {
    kind: "fields",
    key: "narrative",
    label: "Notes",
    blurb:
      "Free-form context for the drafting AI — anything that would normally go in a kickoff call.",
    fields: [
      {
        key: "notes",
        label: "Background notes",
        control: "textarea",
      },
    ],
  },
];

const DEFAULT_SECTION_KEY = SECTIONS[0]!.key;

const DEBOUNCE_MS = 800;

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export type IntakeWizardProps = {
  caseId: string;
  initial: BeneficiaryData;
  rowRevision: number;
  currentStatus: string;
  locked: boolean;
  /** Server-resolved active section key (from `?section=` on the URL).
   *  Seeded by the page from its server-side searchParams so the SSR
   *  render and the client hydrate produce identical HTML. The
   *  `useSearchParams` hook is still used for soft-navigation updates
   *  AFTER hydration (see below). */
  initialSection?: string;
};

export function IntakeWizard(props: IntakeWizardProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Resolve the active section key once per render. On the server-side
  // pass we read the prop (server-supplied via the page's searchParams);
  // on the client we read from the hook so navigation via router.push
  // updates the active section without a full refresh. Both sources
  // agree on the first render because the prop is exactly what the URL
  // says — no SSR/CSR mismatch.
  const hookSection = searchParams.get("section");
  const propSection = props.initialSection ?? null;
  const sectionParam = hookSection ?? propSection;
  const activeKey =
    SECTIONS.find((s) => s.key === sectionParam)?.key ?? DEFAULT_SECTION_KEY;
  const activeSection =
    SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0]!;

  const update = trpc.case.updateBeneficiary.useMutation();
  const complete = trpc.case.completeIntake.useMutation();
  // Recommenders live in their own table; query here so the section
  // navigation can show the live count alongside the field-section
  // filled/total counters. The list itself is rendered by
  // RecommenderListEditor, which subscribes to the same query — tRPC
  // dedupes the request.
  const recommenderListQuery = trpc.recommender.list.useQuery({
    caseId: props.caseId,
  });
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<BeneficiaryData>(props.initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Track the row revision so we always pass the latest expected
  // version to the mutation (the procedure bumps it on each save).
  const revisionRef = useRef(props.rowRevision);
  // Track the patch we last submitted so we don't re-fire the same
  // payload on tab focus / clock tick.
  const lastPatchRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = useCallback(
    (patchSource: BeneficiaryData) => {
      if (props.locked) return;
      // Build the patch from non-empty values only — empty strings
      // would fail Zod's `.min(1)` on inputs that have it.
      const patch: Partial<BeneficiaryData> = {};
      for (const [k, raw] of Object.entries(patchSource)) {
        if (raw === undefined || raw === null) continue;
        if (typeof raw === "string") {
          const trimmed = raw.trim();
          if (trimmed.length > 0) {
            (patch as Record<string, string>)[k] = trimmed;
          }
        } else if (typeof raw === "number" && Number.isFinite(raw)) {
          (patch as Record<string, number>)[k] = raw;
        }
      }
      // Empty patch = nothing to save (e.g. user opened a fresh
      // section then navigated away). Server rejects `{}` with
      // BAD_REQUEST; bail before the round-trip.
      if (Object.keys(patch).length === 0) return;
      const serialized = JSON.stringify(patch);
      if (serialized === lastPatchRef.current) return;
      lastPatchRef.current = serialized;

      update.mutate(
        {
          caseId: props.caseId,
          patch,
          expectedRowRevision: revisionRef.current,
        },
        {
          onSuccess: () => {
            // Server bumps the revision per save; assume +1 to keep
            // subsequent debounced saves in sync without a refetch.
            revisionRef.current += 1;
            setSavedAt(new Date());
          },
        },
      );
    },
    [props.caseId, props.locked, update],
  );

  const scheduleSave = useCallback(
    (next: BeneficiaryData) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => flushSave(next), DEBOUNCE_MS);
    },
    [flushSave],
  );

  // Flush any pending debounced save when the user switches sections
  // or unmounts — guarantees no edit is lost.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function setField<K extends FieldKey>(key: K, value: BeneficiaryData[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }

  function navigateToSection(key: string) {
    // Flush before navigation so the next section sees the latest
    // saved state (router.refresh would otherwise replay stale data).
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    flushSave(values);
    const url = `${APP_ROUTES.caseIntake(props.caseId)}?section=${key}`;
    router.push(url, { scroll: false });
  }

  function onSubmit() {
    if (props.currentStatus !== "intake") return;
    // Make sure pending edits land before completing.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    flushSave(values);
    complete.mutate(
      {
        caseId: props.caseId,
        expectedRowRevision: revisionRef.current,
      },
      {
        onSuccess: () =>
          startTransition(() => router.push(APP_ROUTES.case(props.caseId))),
      },
    );
  }

  const error = update.error?.message ?? complete.error?.message ?? null;
  const busy = update.isPending || complete.isPending || isPending;
  const recommenderCount = recommenderListQuery.data?.length ?? 0;
  const sectionStatus = useMemo(
    () =>
      SECTIONS.map((s) => {
        if (s.kind === "fields") {
          return {
            key: s.key,
            label: s.label,
            filled: countFilled(s, values),
            total: s.fields.length,
          };
        }
        // Recommenders has no fixed target — show the live count as
        // `N/—` so the nav row stays informative without implying a
        // ceiling. SectionNav formats `total: null` accordingly.
        return {
          key: s.key,
          label: s.label,
          filled: recommenderCount,
          total: null as number | null,
        };
      }),
    [values, recommenderCount],
  );

  return (
    <div
      className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]"
      data-component="intake-wizard"
    >
      <SectionNav
        sections={sectionStatus}
        activeKey={activeKey}
        onSelect={(key) => navigateToSection(key)}
      />

      <div className="space-y-6">
        <Card title={activeSection.label}>
          <p
            className="mb-5 text-sm"
            style={{ color: "var(--ink-muted)" }}
          >
            {activeSection.blurb}
          </p>
          {activeSection.kind === "fields" ? (
            <div className="space-y-4">
              {activeSection.fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  disabled={props.locked}
                  onChange={(v) => setField(field.key, v)}
                />
              ))}
            </div>
          ) : (
            <RecommenderListEditor
              caseId={props.caseId}
              locked={props.locked}
            />
          )}
        </Card>

        {error ? (
          <p
            role="alert"
            className="rounded-md border p-3 text-sm"
            style={{
              borderColor: "var(--danger, #b1330e)",
              color: "var(--danger, #b1330e)",
              background: "var(--danger-soft, rgba(177,51,14,0.06))",
            }}
          >
            {error}
          </p>
        ) : null}

        <FooterBar
          locked={props.locked}
          busy={busy}
          savedAt={savedAt}
          updatePending={update.isPending}
          submitPending={complete.isPending}
          canComplete={props.currentStatus === "intake"}
          nextSection={nextSectionAfter(activeSection.key)}
          onNext={(key) => navigateToSection(key)}
          onSubmit={onSubmit}
        />

        {props.locked ? (
          <EmptyState
            title="Read-only — intake is locked."
            subtitle={`Beneficiary data is locked once status passes documents_pending. Current status: ${props.currentStatus}.`}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function SectionNav(props: {
  sections: ReadonlyArray<{
    key: string;
    label: string;
    filled: number;
    /** `null` for sections with no fixed target (recommenders).
     *  Renders as `N/—`. */
    total: number | null;
  }>;
  activeKey: string;
  onSelect: (key: string) => void;
}): React.ReactElement {
  return (
    <nav aria-label="Intake sections">
      <ul className="space-y-1">
        {props.sections.map((s, idx) => {
          const active = s.key === props.activeKey;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => props.onSelect(s.key)}
                className="flex w-full items-baseline gap-2 rounded-sm px-3 py-2 text-left text-sm transition"
                style={{
                  background: active
                    ? "var(--surface-sunken, rgba(0,0,0,0.04))"
                    : "transparent",
                  color: active ? "var(--ink)" : "var(--ink-muted)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                <span
                  className="mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">{s.label}</span>
                <span
                  className="mono text-[10px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {s.filled}/{s.total ?? "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FieldRow(props: {
  field: FieldDef;
  value: unknown;
  disabled: boolean;
  onChange: (v: string | number | undefined) => void;
}): React.ReactElement {
  const id = `intk-${props.field.key}`;
  const inputClass =
    "w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60";
  const inputStyle = {
    borderColor: "var(--border, rgba(0,0,0,0.15))",
    background: "var(--surface, white)",
    color: "var(--ink)",
  } as const;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-medium"
        style={{ color: "var(--ink)" }}
      >
        {props.field.label}
      </label>
      {props.field.control === "textarea" ? (
        <textarea
          id={id}
          rows={6}
          value={typeof props.value === "string" ? props.value : ""}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      ) : (
        <input
          id={id}
          type={inputType(props.field.control)}
          value={
            props.value === undefined || props.value === null
              ? ""
              : String(props.value)
          }
          disabled={props.disabled}
          onChange={(e) => {
            if (props.field.control === "number") {
              // Keep the prior value on transient invalid input ("",
              // "1.", "abc"). Pushing `undefined` here would silently
              // erase a previously-valid number when the user momentarily
              // clears the field — bug surfaced in the audit.
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) props.onChange(n);
              else if (e.target.value === "") props.onChange(undefined);
            } else {
              props.onChange(e.target.value);
            }
          }}
          className={inputClass}
          style={inputStyle}
        />
      )}
      {props.field.hint ? (
        <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {props.field.hint}
        </p>
      ) : null}
    </div>
  );
}

function FooterBar(props: {
  locked: boolean;
  busy: boolean;
  savedAt: Date | null;
  updatePending: boolean;
  submitPending: boolean;
  canComplete: boolean;
  /** Next section after the current one, or `null` on the last section.
   *  When non-null, the primary CTA advances the wizard instead of
   *  firing `completeIntake`. Auto-save means data persists either way;
   *  the CTA's only job is page navigation up to section 4. */
  nextSection: SectionDef | null;
  onNext: (key: string) => void;
  onSubmit: () => void;
}): React.ReactElement {
  const onLastSection = props.nextSection === null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        {props.locked
          ? "Editing disabled."
          : props.updatePending
            ? "Saving…"
            : props.savedAt
              ? `Saved at ${props.savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "Auto-saves as you type."}
      </p>
      {!props.locked ? (
        onLastSection ? (
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.busy || !props.canComplete}
            className="rounded-md border px-4 py-2 text-sm font-medium text-[var(--cream)] disabled:opacity-50"
            style={{ borderColor: "var(--ink)", background: "var(--ink)" }}
            title={
              !props.canComplete ? "Intake already submitted" : "Submit intake"
            }
          >
            {props.submitPending ? "Submitting…" : "Submit intake →"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => props.onNext(props.nextSection!.key)}
            disabled={props.busy}
            className="rounded-md border px-4 py-2 text-sm font-medium text-[var(--cream)] disabled:opacity-50"
            style={{ borderColor: "var(--ink)", background: "var(--ink)" }}
            title={`Continue to ${props.nextSection!.label}`}
          >
            Next: {props.nextSection!.label} →
          </button>
        )
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function inputType(control: FieldDef["control"]): string {
  switch (control) {
    case "date":
      return "date";
    case "number":
      return "number";
    case "email":
      return "email";
    default:
      return "text";
  }
}

function nextSectionAfter(activeKey: string): SectionDef | null {
  const idx = SECTIONS.findIndex((s) => s.key === activeKey);
  if (idx === -1 || idx >= SECTIONS.length - 1) return null;
  return SECTIONS[idx + 1] ?? null;
}

function countFilled(
  section: FieldsSectionDef,
  values: BeneficiaryData,
): number {
  let n = 0;
  for (const f of section.fields) {
    const v = values[f.key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim().length === 0) continue;
    n += 1;
  }
  return n;
}
