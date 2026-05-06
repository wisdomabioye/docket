import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  CircleHelp,
  Cpu,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Home,
  LayoutDashboard,
  type LucideIcon,
  Link2,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Quote,
  RefreshCcw,
  Search,
  Settings,
  Shield,
  TrendingDown,
  TrendingUp,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single icon entry-point per CLAUDE.md §5: no direct `<LucideX />`
 * imports allowed in pages. All icons funnel through this wrapper so
 * default size, stroke weight, and accessible labelling stay consistent.
 *
 * Defaults: `size=16`, `strokeWidth=1.5` (per CLAUDE.md §5).
 *
 * Adding an icon: import the Lucide component, add to `ICON_MAP`, add to
 * `IconName`. Tree-shaken at build — unused icons cost nothing.
 */

const ICON_MAP = {
  "arrow-down": ArrowDown,
  "arrow-down-right": ArrowDownRight,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-up-right": ArrowUpRight,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  circle: Circle,
  "circle-help": CircleHelp,
  "clipboard-list": ClipboardList,
  cpu: Cpu,
  "dollar-sign": DollarSign,
  download: Download,
  "external-link": ExternalLink,
  "file-text": FileText,
  filter: Filter,
  home: Home,
  "layout-dashboard": LayoutDashboard,
  link: Link2,
  "log-out": LogOut,
  menu: Menu,
  "more-horizontal": MoreHorizontal,
  plus: Plus,
  quote: Quote,
  "refresh-ccw": RefreshCcw,
  search: Search,
  settings: Settings,
  shield: Shield,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
  upload: Upload,
  user: User,
  users: Users,
  x: X,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON_MAP;

export function Icon(props: {
  name: IconName;
  /** Pixel size; default 16. */
  size?: number;
  /** Stroke weight; default 1.5. */
  strokeWidth?: number;
  className?: string;
  /** When the icon stands alone (no nearby text label), supply a label. */
  label?: string;
}): React.ReactElement {
  const Component = ICON_MAP[props.name];
  return (
    <Component
      size={props.size ?? 16}
      strokeWidth={props.strokeWidth ?? 1.5}
      className={cn("inline-block shrink-0", props.className)}
      aria-hidden={props.label ? undefined : true}
      {...(props.label ? { "aria-label": props.label, role: "img" } : {})}
    />
  );
}
