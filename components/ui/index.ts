/** Barrel for generic UI primitives. Consumed across every domain
 * (admin, case, document, output, marketing). Keep these dumb,
 * stateless, and free of domain-specific copy. */

export { Badge, type BadgeVariant } from "./Badge";
export { Card } from "./Card";
export { DateInput, type DateInputProps } from "./DateInput";
export {
  Checklist,
  type ChecklistItem,
  type ChecklistItemStatus,
  type ChecklistProps,
} from "./Checklist";
export { EmptyState } from "./EmptyState";
export { ProgressBar, type ProgressTone } from "./ProgressBar";
export { Icon, type IconName } from "./Icon";
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./Segmented";
