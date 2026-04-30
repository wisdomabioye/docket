"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc/react";
import { Card, Badge } from "@/components/ui";
import { OUTPUT_TYPE_DISPLAY, readRecommenderName } from "@/lib/output-types";
import type { OutputType } from "@/server/services/computer/types";

/**
 * Stage 11 γ package assembly. Mockup `package.html` `.assembly` (l.
 * 128-160) — drag-to-reorder list of approved outputs that becomes
 * the page order in the compiled PDF.
 *
 * State model:
 *   - Initial order from the server (rendered by the page).
 *   - User drags → local `items` reorder optimistically.
 *   - Mutation `case.setPackageOrder` persists `outputType:subgroupKey`
 *     keys (type-stable across regenerates).
 *   - Mutation rejects → revert to server-confirmed order.
 *
 * Keys are `outputType:subgroupKey`. For unsubgrouped outputs (e.g.
 * `petition_letter`), the key is just `outputType`. The PDF service
 * reads the same key shape from `cases.package_order`.
 */

export type PackageAssemblyItem = {
  /** Stable key — `outputType:subgroupKey` (or just `outputType`). */
  key: string;
  outputType: OutputType;
  outputVersion: number;
  subgroupKey: string | null;
  metadata: unknown;
};

export type PackageAssemblyCardProps = {
  caseId: string;
  initialItems: ReadonlyArray<PackageAssemblyItem>;
  disabled?: boolean;
};

export function PackageAssemblyCard(
  props: PackageAssemblyCardProps,
): React.ReactElement {
  const [items, setItems] = useState<ReadonlyArray<PackageAssemblyItem>>(
    props.initialItems,
  );
  // If the server snapshot changes (router.refresh after a regen, etc.)
  // accept it as the new baseline. Local edits in flight are dropped on
  // purpose — server is canonical once the user navigates away.
  // Reconcile during render via the React-recommended "store previous
  // prop in state" pattern instead of a useEffect — avoids the cascading
  // render and the `react-hooks/set-state-in-effect` lint.
  const [seenInitial, setSeenInitial] =
    useState<ReadonlyArray<PackageAssemblyItem>>(props.initialItems);
  if (seenInitial !== props.initialItems) {
    setSeenInitial(props.initialItems);
    setItems(props.initialItems);
  }
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Serialize drag → save chain so out-of-order responses can't make
  // the server commit an OLDER order than the user's last gesture.
  // Without this, two fast drags can race: response A arrives after
  // response B and the DB ends up at A's state, contradicting the
  // user's last drag.
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());
  const setOrder = trpc.case.setPackageOrder.useMutation();

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.key === active.id);
    const newIndex = items.findIndex((i) => i.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove([...items], oldIndex, newIndex);
    setItems(next);
    inFlightRef.current = inFlightRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await setOrder.mutateAsync({
            caseId: props.caseId,
            orderedKeys: next.map((i) => i.key),
          });
          setError(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Save failed.";
          setError(message);
          // Roll back local state to the last server-confirmed order.
          setItems(props.initialItems);
        }
      });
  }

  const itemKeys = useMemo(() => items.map((i) => i.key), [items]);

  if (props.initialItems.length === 0) {
    return (
      <Card title="Packet assembly">
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          Approve drafts on the Outputs tab before assembling the packet.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Packet assembly"
      meta={
        <span
          className="text-[11px]"
          style={{ color: "var(--ink-muted)" }}
        >
          drag to reorder
        </span>
      }
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={itemKeys} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {items.map((item, idx) => (
              <SortableRow
                key={item.key}
                item={item}
                index={idx + 1}
                disabled={Boolean(props.disabled) || setOrder.isPending}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {error ? (
        <p
          role="alert"
          className="mt-3 text-xs"
          style={{ color: "var(--danger, #b1330e)" }}
        >
          {error}
        </p>
      ) : null}
      {setOrder.isPending ? (
        <p
          className="mt-3 text-[11px]"
          style={{ color: "var(--ink-muted)" }}
        >
          Saving order…
        </p>
      ) : null}
    </Card>
  );
}

function SortableRow(props: {
  item: PackageAssemblyItem;
  index: number;
  disabled: boolean;
}): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.key, disabled: props.disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const recommender = readRecommenderName({
    outputType: props.item.outputType,
    metadata: props.item.metadata,
  });

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="grid items-center gap-3 rounded-sm border px-3 py-2"
      data-dragging={isDragging || undefined}
    >
      <div
        className="grid items-center gap-3"
        style={{
          gridTemplateColumns: "16px 28px minmax(0,1fr) 80px",
        }}
      >
        <button
          type="button"
          aria-label={`Drag ${OUTPUT_TYPE_DISPLAY[props.item.outputType]}`}
          disabled={props.disabled}
          {...attributes}
          {...listeners}
          className="cursor-grab text-base leading-none disabled:cursor-not-allowed"
          style={{ color: "var(--ink-muted)" }}
        >
          ⋮⋮
        </button>
        <span
          className="mono text-[10px] uppercase tracking-wider"
          style={{ color: "var(--ink-muted)" }}
        >
          {String(props.index).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {OUTPUT_TYPE_DISPLAY[props.item.outputType]}
            {recommender ? ` · ${recommender}` : ""}
          </p>
          <p
            className="mt-0.5 text-[11px]"
            style={{ color: "var(--ink-muted)" }}
          >
            v{props.item.outputVersion} · approved
          </p>
        </div>
        <Badge variant="success">Ready</Badge>
      </div>
    </li>
  );
}
