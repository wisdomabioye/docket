/** Dashboard composites — built on top of `ui/` + `kpi/` primitives.
 *  Used only by `app/(app)/(workspace)/dashboard/page.tsx`. */

export { ActivityFeed, type ActivityFeedProps, type ActivityItem } from "./ActivityFeed";
export { Caseline, type CaselineProps } from "./Caseline";
export { CaselineList, type CaselineListProps } from "./CaselineList";
export { GreetingBand, greetingFor, type GreetingBandProps } from "./GreetingBand";
export { KpiStripDashboard, type KpiStripDashboardProps } from "./KpiStripDashboard";
export { TodayCard, type TodayCardProps, type TodayItem } from "./TodayCard";
