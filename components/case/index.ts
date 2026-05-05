/** Case-domain composites — built on `ui/` + `layout/` primitives.
 *  Used only inside `app/(app)/(workspace)/case/*`. */

export { CaseHeader, type CaseHeaderProps, type CaseTab } from "./CaseHeader";
export {
  CriteriaCoverageCard,
  type CriteriaCoverageCardProps,
} from "./CriteriaCoverageCard";
export {
  RequiredDocsCard,
  type RequiredDocsCardProps,
  type RequiredDocsItem,
} from "./RequiredDocsCard";
export { IntakeWizard, type IntakeWizardProps } from "./IntakeWizard";
export {
  RecommenderListEditor,
  type RecommenderListEditorProps,
} from "./RecommenderListEditor";
export {
  PackageAssemblyCard,
  type PackageAssemblyCardProps,
  type PackageAssemblyItem,
} from "./PackageAssemblyCard";
export {
  PackageDraftNotice,
  type PackageDraftNoticeProps,
} from "./PackageDraftNotice";
export {
  PreflightCard,
  type PreflightCardProps,
  type PreflightGateView,
} from "./PreflightCard";
export { StorageCard, type StorageCardProps } from "./StorageCard";
