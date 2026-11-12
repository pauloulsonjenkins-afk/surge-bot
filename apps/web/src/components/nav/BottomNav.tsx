"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Radio, ListChecks, CalendarDays, MoreHorizontal, Crown, Gauge, Layers, TrendingUp } from "lucide-react";
import { AdviceBadge } from "@/components/admin/AdviceBadge";
import { useUiStore } from "@/state/ui.store";
import { isValidMoreRoute } from "@/lib/routes";
import { TAB_PAGE } from "@/lib/user-pages";
import { useMe } from "@/queries/use-me";

const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, isMore: false },
  { href: "/live", label: "Live", icon: Radio, isMore: false },
  { href: "/trade-log", label: "Trade Log", icon: ListChecks, isMore: false },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, isMore: false },
  // The Members platform (beta): opens its own frame at /members.
  { href: "/members", label: "Members", icon: Crown, isMore: false },
  { href: "/more", label: "More", icon: MoreHorizontal, isMore: true },
] as const;

/**
 * The admin's own bar (design review, 8 Nov 2026), from the overview to the detail: Dashboard, Today, Live,
 * Strategies, Profit, then More. It replaced the admin tab strip that sat at the top as well (two menus, ten places, the
 * strip cut off at "M…"). Dashboard was first left to More, which put the main page a level down (owner, 8 Nov 2026).
 * Trade Log and Schedule are listed on More.
 */
const ADMIN_TABS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, isMore: false },
  { href: "/more/admin/today", label: "Today", icon: Gauge, isMore: false },
  { href: "/live", label: "Live", icon: Radio, isMore: false },
  { href: "/more/admin/strategies", label: "Strategies", icon: Layers, isMore: false },
  { href: "/more/admin/winloss", label: "Profit", icon: TrendingUp, isMore: false },
  { href: "/more", label: "More", icon: MoreHorizontal, isMore: true },
] as const;

/** A signed-in user only sees the tabs the admin has given them. Signed-out visitors and the admin see them all
 * (a signed-out visitor who taps one is offered the sign-in). */
export function useVisibleTabs() {
  const { data: me } = useMe();
  return TABS.filter((t) => {
    // Hidden until we know who is looking: it showed for a moment (or for good, if the check failed) to the admin.
    if (t.href === "/members" && (!me || me.admin)) return false;
    const needs = TAB_PAGE[t.href] ?? null;
    if (!needs || !me || me.admin || !me.user) return true;
    return me.pages.includes(needs);
  });
}

/**
 * A tap on the bar (phone polish, 12 Nov 2026). On the tab you are already on, it goes back to the top of the page,
 * as phone apps do, instead of loading the same page again. Any tap gives a very short buzz where the phone
 * supports it (Android; iPhones ignore it), so a press is felt as well as seen.
 */
export function onTabTap(e: { preventDefault(): void }, sameTab: boolean): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // no vibration here
  }
  if (!sameTab) return;
  e.preventDefault();
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const to = { top: 0, behavior: smooth ? "smooth" : "auto" } as const;
  window.scrollTo(to);
  document.querySelector("main")?.scrollTo(to);
}

/** The tab bar along the bottom of the screen on phones and tablets. Wide screens use the sidebar instead. */
export default function BottomNav() {
  const pathname = usePathname();
  const lastMoreRoute = useUiStore((s) => s.lastMoreRoute);
  const visible = useVisibleTabs();
  const { data: me } = useMe();
  const admin = me?.admin === true;
  const tabs = admin ? ADMIN_TABS : visible;
  const own = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Primary"
      className="bottom-nav fixed inset-x-0 bottom-0 z-40 border-t lg:hidden border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-1 max-[360px]:px-1">
        {tabs.map(({ href, label, icon: Icon, isMore }) => {
          const target = isMore ? (admin ? "/more" : isValidMoreRoute(lastMoreRoute) ? lastMoreRoute : "/more") : href;
          // For the admin, More is lit for every page that isn't one of the four tabs (Dashboard, Golden, Settings...).
          const active = isMore ? (admin ? !ADMIN_TABS.some((t) => !t.isMore && own(t.href)) : pathname.startsWith("/more")) : own(href);

          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={target}
                aria-current={active ? "page" : undefined}
                onClick={(e) => onTabTap(e, pathname === target)}
                className={`tab-link relative flex flex-col items-center gap-0.5 whitespace-nowrap py-2 text-[0.75rem] leading-4 transition-colors max-[360px]:text-[0.65rem] max-[360px]:tracking-tight ${
                  active ? "font-semibold text-accent" : "text-ink-muted"
                }`}
              >
                {/* The current tab's icon sits on a soft pill that eases in, so where you are reads at a glance. */}
                <span className={`tab-pill relative rounded-full px-4 py-0.5 max-[360px]:px-2.5 ${active ? "bg-accent/15" : "bg-transparent"}`}>
                  <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                  {admin && href === "/more/admin/strategies" && (
                    <span className="absolute -right-0.5 -top-1.5 scale-90">
                      <AdviceBadge href={href} />
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}