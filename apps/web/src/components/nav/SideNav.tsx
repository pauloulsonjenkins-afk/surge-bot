"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { useVisibleTabs } from "./BottomNav";
import { useMe } from "@/queries/use-me";
import { ADMIN_SECTIONS } from "@/lib/admin-sections";
import ThemeToggle from "@/components/ui/ThemeToggle";

const itemCls = (active: boolean) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
    active ? "bg-surface-2 font-medium text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
  }`;

/**
 * The navigation on wide screens (laptop and desktop): a fixed column on the left with the main pages and,
 * for the admin, the admin pages under their own heading. Phones keep the bottom tab bar.
 */
export default function SideNav() {
  const pathname = usePathname();
  const tabs = useVisibleTabs();
  const { data: me } = useMe();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-5 pb-4 pt-5">
        <p className="text-base font-semibold tracking-tight text-ink">Goal Brewing Alerts</p>
        <p className="text-xs text-ink-muted">Live football alerts</p>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {tabs.map(({ href, label, icon: Icon, isMore }) => {
            // On wide screens the admin pages are listed below, so More is only "active" on the More page itself.
            const active = isMore ? pathname === "/more" : isActive(href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={itemCls(active)}>
                  <Icon size={18} strokeWidth={active ? 2.3 : 1.8} className={active ? "text-accent" : ""} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {me?.admin && (
          <>
            <p className="mb-1 mt-6 flex items-center gap-1.5 px-3 text-xs font-medium text-ink-muted">
              <Lock size={12} /> Admin
            </p>
            <ul className="space-y-0.5">
              {ADMIN_SECTIONS.map((s) => {
                const active = isActive(s.href);
                return (
                  <li key={s.href}>
                    <Link href={s.href} aria-current={active ? "page" : undefined} className={itemCls(active)}>
                      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} aria-hidden />
                      {s.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </nav>

      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        <span className="text-xs text-ink-muted">Theme</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
