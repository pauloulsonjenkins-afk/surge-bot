"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Radio, ListChecks, CalendarDays, MoreHorizontal } from "lucide-react";
import { useUiStore } from "@/state/ui.store";
import { isValidMoreRoute } from "@/lib/routes";
import { TAB_PAGE } from "@/lib/user-pages";
import { useMe } from "@/queries/use-me";

const TABS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, isMore: false },
  { href: "/live", label: "Live", icon: Radio, isMore: false },
  { href: "/trade-log", label: "Trade Log", icon: ListChecks, isMore: false },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, isMore: false },
  { href: "/more", label: "More", icon: MoreHorizontal, isMore: true },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const lastMoreRoute = useUiStore((s) => s.lastMoreRoute);
  const { data: me } = useMe();

  // A signed-in user only sees the tabs the admin has given them. Signed-out visitors and the admin see them all
  // (a signed-out visitor who taps one is offered the sign-in).
  const tabs = TABS.filter((t) => {
    const needs = TAB_PAGE[t.href] ?? null;
    if (!needs || !me || me.admin || !me.user) return true;
    return me.pages.includes(needs);
  });

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-1">
        {tabs.map(({ href, label, icon: Icon, isMore }) => {
          const target = isMore ? (isValidMoreRoute(lastMoreRoute) ? lastMoreRoute : "/more") : href;
          const active = isMore
            ? pathname.startsWith("/more")
            : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href} className="flex-1">
              <Link
                href={target}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                  active ? "text-accent" : "text-ink-muted"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}