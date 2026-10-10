import { CalendarDays, LayoutDashboard, Coffee, Radar, LineChart, History, Zap, Users, Settings, Crown } from "lucide-react";

/**
 * The Members platform's navigation, in one place. To integrate the platform into the main site later, add these items
 * to the main navigation and drop MembersShell: the pages themselves don't depend on it.
 */
export const MEMBERS_NAV = [
  { href: "/members", label: "Dashboard", short: "Home", icon: LayoutDashboard, mobile: true },
  { href: "/members/strategies", label: "Strategies", short: "Strategies", icon: Coffee, mobile: true },
  { href: "/members/upcoming", label: "Upcoming", short: "Upcoming", icon: Radar, mobile: true },
  { href: "/members/fixtures", label: "Fixtures · Edge", short: "Fixtures", icon: CalendarDays, mobile: false },
  { href: "/members/performance", label: "My Performance", short: "Performance", icon: LineChart, mobile: true },
  { href: "/members/history", label: "Bet History", short: "History", icon: History, mobile: false },
  { href: "/members/automation", label: "Betfair Automation", short: "Automation", icon: Zap, mobile: false },
  { href: "/members/community", label: "Community", short: "Community", icon: Users, mobile: false },
  { href: "/members/settings", label: "Settings", short: "Settings", icon: Settings, mobile: false },
  { href: "/members/upgrade", label: "Membership", short: "Membership", icon: Crown, mobile: false },
] as const;
