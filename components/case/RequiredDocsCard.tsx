import {
  Card,
  Checklist,
  EmptyState,
  ProgressBar,
  type ChecklistItem,
} from "@/components/ui";
import { RECOMMENDER_LETTER_HINT } from "@/lib/recommender-letter";

/**
 * Stage 11 β required-documents checklist for the Documents right
 * rail. Mockup `documents.html` `.checklist` (l. 354-372).
 *
 * Rows are grouped by `phase` so attorneys aren't blocked waiting on
 * evidence that doesn't exist yet:
 *   - `pre_build`  → needed before the AI build runs (CV, awards…)
 *   - `post_build` → collected after drafts are sent and signed letters
 *                    return (recommendation letters)
 *
 * Each row's status:
 *   - `present === true`  → done glyph
 *   - `present === false` → open glyph + "MISSING" tag
 *   - `present === null`  → unknown glyph + "MANUAL" tag (the
 *     required doc has no enum bucket; attorney verifies manually)
 *
 * Header shows overall progress; each group shows its own count + bar.
 */

export type RequiredDocsPhase = "pre_build" | "post_build";

export type RequiredDocsItem = {
  key: string;
  label: string;
  criterion: number | null;
  count: number;
  minCount: number;
  /** `null` means manual-verify (no enum mapping); `true|false` is the
   *  auto-tick status. */
  present: boolean | null;
  /** Defaults to `pre_build` when older callers omit it. */
  phase?: RequiredDocsPhase;
};

export type RequiredDocsCardProps = {
  visaType: string;
  visaSupported: boolean;
  items: ReadonlyArray<RequiredDocsItem>;
};

const GROUP_ORDER: ReadonlyArray<RequiredDocsPhase> = [
  "pre_build",
  "post_build",
];

const GROUP_META: Record<
  RequiredDocsPhase,
  { title: string; hint: string }
> = {
  pre_build: {
    title: "Before Build",
    hint: "Upload these so the AI has source material to draft from.",
  },
  post_build: {
    title: "After drafts go out",
    hint: RECOMMENDER_LETTER_HINT,
  },
};

export function RequiredDocsCard(
  props: RequiredDocsCardProps,
): React.ReactElement {
  if (!props.visaSupported) {
    return (
      <Card title="Required documents">
        <EmptyState
          title={`Required-doc list for ${props.visaType} ships in a future release.`}
          subtitle="O-1A is the only visa with a checklist in Phase 1."
        />
      </Card>
    );
  }

  const groups = GROUP_ORDER.map((phase) => ({
    phase,
    items: props.items.filter((i) => (i.phase ?? "pre_build") === phase),
  })).filter((g) => g.items.length > 0);

  const total = props.items.length;
  const done = props.items.filter((i) => i.present === true).length;

  return (
    <Card
      title={`Required for ${props.visaType}`}
      meta={
        <span className="mono text-[11px]">
          {done} / {total}
        </span>
      }
    >
      <div className="space-y-5">
        {groups.map((g) => (
          <RequiredDocsGroup
            key={g.phase}
            title={GROUP_META[g.phase].title}
            hint={GROUP_META[g.phase].hint}
            items={g.items}
          />
        ))}
      </div>
    </Card>
  );
}

function RequiredDocsGroup(props: {
  title: string;
  hint: string;
  items: ReadonlyArray<RequiredDocsItem>;
}): React.ReactElement {
  const total = props.items.length;
  const done = props.items.filter((i) => i.present === true).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const checklistItems: ChecklistItem[] = props.items.map((i) => ({
    key: i.key,
    label: i.label,
    status:
      i.present === true ? "done" : i.present === null ? "unknown" : "open",
    ...(buildTag(i) ?? {}),
  }));
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-[11px] font-medium uppercase tracking-[0.18em]">
          {props.title}
        </h4>
        <span className="mono text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {done} / {total}
        </span>
      </header>
      <p
        className="mb-2 text-[11px] leading-relaxed"
        style={{ color: "var(--ink-muted)" }}
      >
        {props.hint}
      </p>
      <div className="mb-3">
        <ProgressBar
          value={percent}
          tone={done === total ? "success" : done >= total / 2 ? "warning" : "accent"}
        />
      </div>
      <Checklist items={checklistItems} />
    </section>
  );
}

function buildTag(item: RequiredDocsItem):
  | { tag: string; tagTone?: "info" | "warning" }
  | null {
  if (item.minCount > 1 && item.present === false) {
    return { tag: `${item.count} OF ${item.minCount}`, tagTone: "warning" };
  }
  if (item.present === null) {
    return { tag: "MANUAL" };
  }
  if (item.present === false && item.criterion !== null) {
    return { tag: `CRIT ${item.criterion}` };
  }
  return null;
}
