/** Stage 08 output-domain composites. Pages import from this barrel
 *  rather than per-file paths so component renames don't ripple
 *  through every consumer. */

export { ApprovalActions } from "./ApprovalActions";
export { DisclaimerBanner } from "./DisclaimerBanner";
export { OutputCard } from "./OutputCard";
export {
  BundleStats,
  type BundleStat,
  type BundleStatsProps,
} from "./BundleStats";
export { RegeneratePanel } from "./RegeneratePanel";
export {
  TiptapEditor,
  useTiptapState,
  type TiptapEditorApi,
} from "./TiptapEditor";
export {
  ExhibitIndexEditor,
  useExhibitIndexEditorState,
  type ExhibitIndexEditorApi,
} from "./ExhibitIndexEditor";
export { VersionHistory } from "./VersionHistory";
