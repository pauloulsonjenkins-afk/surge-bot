import type { ComponentType } from "react";
import { CalendarDays, ChevronRight, Home, Layers, ListChecks, Radio, Send, Settings, TrendingUp, Trophy } from "lucide-react";
import { HorseHeadIcon } from "@/components/ui/HorseHeadIcon";

export type NavIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** One icon per menu entry, the same on the tab bar, the sidebar and the More page. */
const NAV_ICONS: Record<string, NavIcon> = {
  "/more/admin/today": Home,
  "/live": Radio,
  "/more/admin/strategies": Layers,
  "/more/admin/winloss": TrendingUp,
  "/more/admin/sending": Send,
  "/trade-log": ListChecks,
  "/schedule": CalendarDays,
  "/more/admin/leagues": Trophy,
  "/more/admin/horses": HorseHeadIcon,
  "/more/admin/settings": Settings,
};

export const navIcon = (href: string): NavIcon => NAV_ICONS[href] ?? ChevronRight;
