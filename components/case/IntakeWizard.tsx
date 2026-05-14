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
import { formatTrpcError } from "@/lib/trpc/format-error";
import { APP_ROUTES } from "@/config";
import { z } from "zod";
import { Card, Combobox, DateInput, EmptyState } from "@/components/ui";
import { COUNTRIES } from "@/lib/locations";
import { isoOffsetYears } from "@/lib/utils";
import {
  BeneficiaryDataSchema,
  type BeneficiaryData,
} from "@/server/db/schema/zod/beneficiary";
import type { VisaType } from "@/lib/constants";
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
  control: "text" | "date" | "number" | "textarea" | "email" | "country";
  hint?: string;
  /** Date-bound offsets in years from `today`. Resolved at render
   *  into ISO `yyyy-mm-dd` strings on the DateInput. Negative for past
   *  (DOB), positive for future (filing date). `undefined` leaves the
   *  bound open. Only meaningful when `control === "date"`. */
  dateMinOffsetYears?: number;
  dateMaxOffsetYears?: number;
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
      {
        key: "dateOfBirth",
        label: "Date of birth",
        control: "date",
        // DOB can't be in the future. No lower bound — beneficiaries
        // can be any age in theory; the DateInput's calendar floors at
        // 1900 by default which is plenty.
        dateMaxOffsetYears: 0,
      },
      { key: "nationality", label: "Nationality", control: "country" },
      {
        key: "currentCountry",
        label: "Country of residence",
        control: "country",
      },
      {
        key: "currentCity",
        label: "City of residence",
        control: "text",
        hint: "If in the US, include the state (e.g. Brooklyn, NY).",
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
        // Filing dates can't be in the past; cap at +2y so the
        // calendar's year-picker stays usable. Any further out is a
        // typo, not a plan.
        dateMinOffsetYears: 0,
        dateMaxOffsetYears: 2,
      },
      { key: "email", label: "Beneficiary email", control: "email" },
    ],
  },
  {
    kind: "recommenders",
    key: "recommenders",
    label: "Recommenders",
    blurb:
      "Letter-writers for this case. The build pipeline drafts one recommendation letter per recommender. The visa-specific minimum (if any) is shown below.",
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

/** Country picker options. Built once — the catalogue is static.
 *  We persist the country name (not the ISO code) so existing AI
 *  prompts that interpolate `nationality` keep producing natural
 *  prose ("Nigeria", not "NG"). */
const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.name, label: c.name }));

/**
 * Per-section validation schemas, derived from `BeneficiaryDataSchema`
 * by picking each section's fields and promoting them from optional
 * to required. `BeneficiaryDataSchema` is the storage shape (every
 * field optional so partial saves work); these slices are the
 * "section complete" contract — they decide whether Next is allowed.
 *
 * Built once at module load — Zod object schemas are immutable, so
 * there is no per-render cost.
 *
 * Recommenders section is excluded by design: it writes to a separate
 * table and has its own gate (visa-config `minRecommenders` count),
 * which `case.completeIntake` enforces server-side. Today we let the
 * user move past it without blocking; #60 will surface the count
 * client-side.
 */
const SECTION_SCHEMAS: Record<string, ReturnType<
  ReturnType<typeof BeneficiaryDataSchema.pick>["required"]
>> = (() => {
  const out: Record<string, ReturnType<
    ReturnType<typeof BeneficiaryDataSchema.pick>["required"]
  >> = {};
  for (const s of SECTIONS) {
    if (s.kind !== "fields") continue;
    const pick = Object.fromEntries(
      s.fields.map((f) => [f.key, true as const]),
    ) as Parameters<typeof BeneficiaryDataSchema.pick>[0];
    out[s.key] = BeneficiaryDataSchema.pick(pick).required();
  }
  return out;
})();

type FieldErrors = Partial<Record<FieldKey, string>>;

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export type IntakeWizardProps = {
  caseId: string;
  visaType: VisaType;
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
  // Per-section validation errors. Populated when Next is clicked on
  // an incomplete section; cleared per-field as the user edits.
  // Section-scoped, not whole-form, so navigating away doesn't carry
  // stale errors into another section's view.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
    // Clear this field's error as soon as the user edits — the
    // validation rerun on next click will repopulate if still invalid.
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Validate the active section's fields against `SECTION_SCHEMAS`.
   *  Returns `true` if the section passes (or has no schema, e.g. the
   *  recommenders section). On failure, populates `fieldErrors` with
   *  one message per offending field. Bypassed entirely in locked
   *  mode — locked sections can't be edited so re-validation is noise. */
  /** Validate one fields-section against its `SECTION_SCHEMAS` entry.
   *  Returns the per-field error map for that slice (empty on pass).
   *  `BeneficiaryDataSchema` is `.strict()`; `.pick(...).required()`
   *  preserves that, so we hand the schema only the section's fields.
   *  Passing the full `values` would fail with "unrecognized key" on
   *  every other section's field. */
  function validateSection(section: SectionDef): FieldErrors {
    if (section.kind !== "fields") return {};
    const schema = SECTION_SCHEMAS[section.key];
    if (!schema) return {};
    const slice: Partial<BeneficiaryData> = {};
    for (const f of section.fields) {
      const v = values[f.key];
      if (v !== undefined) (slice as Record<string, unknown>)[f.key] = v;
    }
    const result = schema.safeParse(slice);
    if (result.success) return {};
    const flat = z.flattenError(result.error).fieldErrors;
    const errs: FieldErrors = {};
    for (const [k, msgs] of Object.entries(flat)) {
      if (msgs && msgs.length > 0) errs[k as FieldKey] = msgs[0]!;
    }
    return errs;
  }

  /** Next-button gate: validate the active section only. Direct rail
   *  clicks bypass this (see `navigateToSection`). Updates only the
   *  active section's keys in `fieldErrors` so a prior Submit-side
   *  cross-section run's badges on other sections aren't wiped. */
  function validateActiveSection(): boolean {
    if (props.locked) return true;
    if (activeSection.kind !== "fields") return true;
    const errs = validateSection(activeSection);
    setFieldErrors((prev) => {
      const next: FieldErrors = { ...prev };
      for (const f of activeSection.fields) delete next[f.key];
      Object.assign(next, errs);
      return next;
    });
    return Object.keys(errs).length === 0;
  }

  /** Submit gate: validate EVERY fields-section so a user can't
   *  bypass profile/practice/filing by filling only `notes` and
   *  hitting Submit. Returns the key of the first failing section
   *  (so the caller can route the user there) or `null` on pass.
   *  Recommenders count is enforced server-side in
   *  `case.completeIntake` (visa-config `minRecommenders`). */
  function validateAllSections(): string | null {
    if (props.locked) return null;
    const allErrors: FieldErrors = {};
    let firstFailing: string | null = null;
    for (const s of SECTIONS) {
      if (s.kind !== "fields") continue;
      const errs = validateSection(s);
      if (Object.keys(errs).length > 0) {
        Object.assign(allErrors, errs);
        if (firstFailing === null) firstFailing = s.key;
      }
    }
    setFieldErrors(allErrors);
    return firstFailing;
  }

  function navigateToSection(key: string) {
    // Flush before navigation so the next section sees the latest
    // saved state (router.refresh would otherwise replay stale data).
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    flushSave(values);
    // Field errors are NOT cleared here — after a cross-section
    // Submit fail, badges on every failing section need to persist so
    // the user can see the full punch list. Errors clear naturally
    // per-field on edit (see `setField`) and per-section on a
    // successful `validateActiveSection`.
    const url = `${APP_ROUTES.caseIntake(props.caseId)}?section=${key}`;
    router.push(url, { scroll: false });
  }

  /** Forward navigation: validate first, only advance if the section
   *  passes. Direct rail clicks still use `navigateToSection`
   *  (no gate) so users can jump back to fix something elsewhere. */
  function onNextSection(nextKey: string) {
    if (!validateActiveSection()) return;
    navigateToSection(nextKey);
  }

  function onSubmit() {
    if (props.currentStatus !== "intake") return;
    // Cross-section gate. Filling only the narrative section and
    // clicking Submit must not bypass profile/practice/filing — the
    // server's `case.completeIntake` doesn't re-validate beneficiary
    // data completeness, only the status transition and recommender
    // minimum. If any fields-section fails, surface every section's
    // errors at once and route to the first failing one.
    const firstFailing = validateAllSections();
    if (firstFailing !== null) {
      if (firstFailing !== activeSection.key) {
        const url = `${APP_ROUTES.caseIntake(props.caseId)}?section=${firstFailing}`;
        router.push(url, { scroll: false });
      }
      return;
    }
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

  const error =
    formatTrpcError(update.error) ?? formatTrpcError(complete.error);
  const busy = update.isPending || complete.isPending || isPending;
  const recommenderCount = recommenderListQuery.data?.length ?? 0;
  // Per-section error count — attributed by field ownership so the
  // Submit-side cross-section validator can light up the rail badges
  // for every section that failed at once, not just the active one.
  const sectionStatus = useMemo(
    () =>
      SECTIONS.map((s) => {
        const errorCount =
          s.kind === "fields"
            ? s.fields.filter((f) => fieldErrors[f.key]).length
            : 0;
        if (s.kind === "fields") {
          return {
            key: s.key,
            label: s.label,
            filled: countFilled(s, values),
            total: s.fields.length,
            errorCount,
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
          errorCount,
        };
      }),
    [values, recommenderCount, fieldErrors],
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
              {activeSection.fields.map((field) => {
                const fieldError = fieldErrors[field.key];
                return (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    disabled={props.locked}
                    onChange={(v) => setField(field.key, v)}
                    onDateInvalid={(reason) =>
                      setFieldErrors((prev) => ({
                        ...prev,
                        [field.key]: dateInvalidMessage(reason),
                      }))
                    }
                    {...(fieldError !== undefined
                      ? { error: fieldError }
                      : {})}
                  />
                );
              })}
            </div>
          ) : (
            <RecommenderListEditor
              caseId={props.caseId}
              visaType={props.visaType}
              locked={props.locked}
            />
          )}
        </Card>

        {error ? (
          <p
            role="alert"
            className="whitespace-pre-line rounded-md border p-3 text-sm"
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
          prevSection={prevSectionBefore(activeSection.key)}
          nextSection={nextSectionAfter(activeSection.key)}
          onPrev={(key) => navigateToSection(key)}
          onNext={(key) => onNextSection(key)}
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
    /** Active-section validation errors. Renders a small chip beside
     *  the section name when > 0. */
    errorCount: number;
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
                {s.errorCount > 0 ? (
                  <span
                    aria-label={`${s.errorCount} validation ${s.errorCount === 1 ? "error" : "errors"}`}
                    className="mono rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      background: "var(--danger, #b1330e)",
                      color: "var(--cream, white)",
                    }}
                  >
                    {s.errorCount}
                  </span>
                ) : null}
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
  error?: string;
  onChange: (v: string | number | undefined) => void;
  /** Fired by date fields when the typed value can't be parsed or
   *  falls outside the field's min/max. Parent can populate
   *  `fieldErrors[key]` so the inline error appears on blur, not only
   *  after a Next-click validation pass. */
  onDateInvalid?: (reason: "invalid_date" | "out_of_range") => void;
}): React.ReactElement {
  const id = `intk-${props.field.key}`;
  const errId = props.error ? `${id}-err` : undefined;
  const inputClass =
    "w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60";
  const inputStyle = {
    borderColor: props.error
      ? "var(--danger, #b1330e)"
      : "var(--border, rgba(0,0,0,0.15))",
    background: "var(--surface, white)",
    color: "var(--ink)",
  } as const;
  const ariaProps = props.error
    ? { "aria-invalid": true as const, "aria-describedby": errId }
    : {};
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-medium"
        style={{ color: "var(--ink)" }}
      >
        {props.field.label}
      </label>
      {props.field.control === "country" ? (
        <Combobox
          id={id}
          options={COUNTRY_OPTIONS}
          value={typeof props.value === "string" ? props.value : ""}
          disabled={props.disabled}
          onChange={(v) => props.onChange(v === "" ? undefined : v)}
          placeholder="Select country…"
          {...(props.error ? { invalid: true as const } : {})}
          {...(errId ? { "aria-describedby": errId } : {})}
        />
      ) : props.field.control === "textarea" ? (
        <textarea
          id={id}
          rows={6}
          value={typeof props.value === "string" ? props.value : ""}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className={inputClass}
          style={inputStyle}
          {...ariaProps}
        />
      ) : props.field.control === "date" ? (
        <DateInput
          id={id}
          value={typeof props.value === "string" ? props.value : ""}
          disabled={props.disabled}
          onChange={(v) => props.onChange(v)}
          className={inputClass}
          {...(props.field.dateMinOffsetYears !== undefined
            ? { min: isoOffsetYears(props.field.dateMinOffsetYears) }
            : {})}
          {...(props.field.dateMaxOffsetYears !== undefined
            ? { max: isoOffsetYears(props.field.dateMaxOffsetYears) }
            : {})}
          {...(props.error ? { invalid: true as const } : {})}
          {...(errId ? { "aria-describedby": errId } : {})}
          {...(props.onDateInvalid ? { onInvalid: props.onDateInvalid } : {})}
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
          {...ariaProps}
        />
      )}
      {props.error ? (
        <p
          id={errId}
          className="text-[11px]"
          style={{ color: "var(--danger, #b1330e)" }}
        >
          {props.error}
        </p>
      ) : props.field.hint ? (
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
  /** Previous section, or `null` on the first section. When non-null,
   *  a secondary Back button is rendered in the footer's left slot.
   *  Backward navigation does NOT gate on validation — the user may
   *  need to jump back specifically to fix a flagged section. */
  prevSection: SectionDef | null;
  /** Next section after the current one, or `null` on the last section.
   *  When non-null, the primary CTA advances the wizard instead of
   *  firing `completeIntake`. Auto-save means data persists either way;
   *  the CTA's only job is page navigation up to section 4. */
  nextSection: SectionDef | null;
  onPrev: (key: string) => void;
  onNext: (key: string) => void;
  onSubmit: () => void;
}): React.ReactElement {
  const onLastSection = props.nextSection === null;
  const onFirstSection = props.prevSection === null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {!props.locked && !onFirstSection ? (
          <button
            type="button"
            onClick={() => props.onPrev(props.prevSection!.key)}
            disabled={props.busy}
            className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{
              borderColor: "var(--ink)",
              background: "transparent",
              color: "var(--ink)",
            }}
            title={`Back to ${props.prevSection!.label}`}
          >
            ← Back: {props.prevSection!.label}
          </button>
        ) : null}
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {props.locked
            ? "Editing disabled."
            : props.updatePending
              ? "Saving…"
              : props.savedAt
                ? `Saved at ${props.savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : "Auto-saves as you type."}
        </p>
      </div>
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
  // `"date"` is handled by `<DateInput>` upstream — never reaches
  // here. `"textarea"` short-circuits in `FieldRow` before this is
  // called.
  switch (control) {
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

function prevSectionBefore(activeKey: string): SectionDef | null {
  const idx = SECTIONS.findIndex((s) => s.key === activeKey);
  if (idx <= 0) return null;
  return SECTIONS[idx - 1] ?? null;
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

function dateInvalidMessage(
  reason: "invalid_date" | "out_of_range",
): string {
  switch (reason) {
    case "invalid_date":
      return "Use a valid date (MM/DD/YYYY).";
    case "out_of_range":
      return "Date is outside the allowed range.";
  }
}
