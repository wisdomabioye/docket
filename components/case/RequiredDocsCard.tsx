import {
  Card,
  Checklist,
  EmptyState,
  ProgressBar,
  type ChecklistItem,
} from "@/components/ui";

/**
 * Stage 11 β required-documents checklist for the Documents right
 * rail. Mockup `documents.html` `.checklist` (l. 354-372).
 *
 * Each row maps to one `requiredDocsFor(visa)` entry:
 *   - `present === true`  → done glyph
 *   - `present === false` → open glyph + "MISSING" tag
 *   - `present === null`  → unknown glyph + "MANUAL" tag (the
 *     required doc has no enum bucket; attorney verifies manually)
 *
 * Header shows progress as `count / total` + a slim progress bar so
 * the attorney can see how close they are at a glance.
 */

export type RequiredDocsItem = {
  key: string;
  label: string;
  criterion: number | null;
  count: number;
  minCount: number;
  /** `null` means manual-verify (no enum mapping); `true|false` is the
   *  auto-tick status. */
  present: boolean | null;
};

export type RequiredDocsCardProps = {
  visaType: string;
  visaSupported: boolean;
  items: ReadonlyArray<RequiredDocsItem>;
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
    <Card
      title={`Required for ${props.visaType}`}
      meta={
        <span className="mono text-[11px]">
          {done} / {total}
        </span>
      }
    >
      <div className="mb-4">
        <ProgressBar
          value={percent}
          tone={done === total ? "success" : done >= total / 2 ? "warning" : "accent"}
        />
      </div>
      <Checklist items={checklistItems} />
    </Card>
  );
}

function buildTag(item: RequiredDocsItem):
  | { tag: string; tagTone?: "info" | "warning" }
  | null {
  // Partial progress (e.g. 2 of 3 rec letters) gets a "2 OF 3" tag.
  if (item.minCount > 1 && item.present === false) {
    return { tag: `${item.count} OF ${item.minCount}`, tagTone: "warning" };
  }
  // Manual-verify items get a MANUAL tag — separates "we can't auto-tick"
  // from "you didn't upload it." The status glyph (`unknown`) carries
  // the same signal; the tag makes the column scannable.
  if (item.present === null) {
    return { tag: "MANUAL" };
  }
  // Criterion attribution shown for fully-open items so the attorney
  // can see which criterion this required-doc unlocks.
  if (item.present === false && item.criterion !== null) {
    return { tag: `CRIT ${item.criterion}` };
  }
  return null;
}
