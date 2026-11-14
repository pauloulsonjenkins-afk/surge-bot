"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { useVisibleTabs } from "./BottomNav";
import { navIcon } from "./nav-icons";
import { useMe } from "@/queries/use-me";
import { ADMIN_MAIN, ADMIN_MORE, navActive, type NavItem } from "@/lib/admin-sections";
import { AdviceBadge } from "@/components/admin/AdviceBadge";
import ThemeToggle from "@/components/ui/ThemeToggle";
import AdminLogoutButton from "./AdminLogoutButton";

const itemCls = (active: boolean) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
    active ? "bg-surface-2 font-medium text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
  }`;

/**
 * The navigation on wide screens (laptop and desktop): a fixed column on the left. For the admin it is the same menu as
 * the phone, in the same order (14 Nov 2026): the four main pages, then what the phone keeps on More. Before, the two
 * screens had different menus and the admin pages sat in a second list under a lock. Everyone else gets the site's tabs.
 */
export default function SideNav() {
  const pathname = usePathname();
  const tabs = useVisibleTabs();
  const { data: me } = useMe();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const adminList = (items: NavItem[]) => (
    <ul className="space-y-0.5">
      {items.map(({ href, label }) => {
        const active = navActive(pathname, href);
        const Icon = navIcon(href);
        return (
          <li key={href}>
            <Link href={href} aria-current={active ? "page" : undefined} className={itemCls(active)}>
              <Icon size={18} strokeWidth={active ? 2.3 : 1.8} className={active ? "text-accent" : ""} />
              {label}
              <AdviceBadge href={href} />
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-5 pb-5 pt-5">
        {/* The GoalBrew logo, 28px tall; the light file has the deeper amber for light backgrounds. */}
        <Image unoptimized priority src="/brand/goalbrew-logo-dark.svg" alt="GoalBrew" width={168} height={28} className="h-7 w-auto [[data-theme=light]_&]:hidden" />
        <Image unoptimized src="/brand/goalbrew-logo-light.svg" alt="GoalBrew" width={168} height={28} className="hidden h-7 w-auto [[data-theme=light]_&]:block" />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3">
        {me?.admin ? (
          <>
            {adminList(ADMIN_MAIN)}
            <p className="mb-1 mt-6 px-3 text-xs text-ink-muted">More</p>
            {adminList(ADMIN_MORE)}
          </>
        ) : (
          <ul className="space-y-0.5">
            {tabs.map(({ href, label, icon: Icon, isMore }) => {
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
        )}

        {/* Signed out (or signed in as a website user): the way into the admin area, which otherwise has no link on wide screens. */}
        {me && !me.admin && (
          <Link href="/more/admin/login" className={`${itemCls(pathname.startsWith("/more/admin"))} mt-6`}>
            <LogIn size={18} strokeWidth={1.8} />
            Admin sign in
          </Link>
        )}
      </nav>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        {me?.admin ? <AdminLogoutButton /> : <span className="text-xs text-ink-muted">Theme</span>}
        <ThemeToggle />
      </div>
    </aside>
  );
}
