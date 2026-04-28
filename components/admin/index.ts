/** Barrel for admin-specific composites. Generic primitives live elsewhere
 * (see `@/components/ui`, `@/components/kpi`, `@/components/table`) — admin
 * pages import from each module explicitly so cross-domain consumers
 * (case detail, document panel, etc.) can adopt the primitives without
 * importing through `admin/`. */

export { AdminSidebar } from "./AdminSidebar";
export { PageHeader } from "./PageHeader";
export { StatBand, type StatCell } from "./StatBand";
export { AuditRow, type AuditEvent, classifyAuditAction } from "./AuditRow";
