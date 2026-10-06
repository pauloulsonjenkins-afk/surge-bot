"use client";

/**
 * The Members platform's frame while it is a beta: its own header (logo, "Members · Beta", back to the main site,
 * notifications, sign out), a side column on wide screens and a tab bar plus "More" sheet on phones.
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Bell, MoreHorizontal, LogOut, X } from "lucide-react";
import { MEMBERS_NAV } from "@/lib/members/nav";
import { useMembersMe } from "@/queries/use-members";
import { useMe, useSignOut } from "@/queries/use-me";
import { TierBadge } from "./ui";

export default function MembersShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me, isPending } = useMembersMe();
  const signOut = useSignOut();
  const siteAdmin = useMe().data?.admin === true;
  const [more, setMore] = useState(false);
  const isActive = (href: string) => (href === "/members" ? pathname === "/members" : pathname === href || pathname.startsWith(`${href}/`));
  const signedIn = Boolean(me);

  return (
    <div className="flex min-h-dvh flex-col bg-app text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/members" className="flex min-w-0 items-center gap-2">
            <Image unoptimized priority src="/brand/goalbrew-logo-dark.svg" alt="GoalBrew" width={120} height={20} className="h-5 w-auto [[data-theme=light]_&]:hidden" />
            <Image unoptimized src="/brand/goalbrew-logo-light.svg" alt="GoalBrew" width={120} height={20} className="hidden h-5 w-auto [[data-theme=light]_&]:block" />
            {/* On phones the logo, membership badge, bell and sign-out fill the bar, so the words wait for wider screens. */}
            <span className="hidden text-sm font-semibold text-ink sm:inline">Members</span>
            <span className="hidden rounded-full border border-accent/50 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-accent sm:inline">Beta</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {me && <TierBadge tier={me.tier} />}
            {me && (
              <Link href="/members/notifications" aria-label={`Notifications${me.unread ? `, ${me.unread} unread` : ""}`} className="relative rounded-md p-1.5 text-ink-muted hover:text-ink">
                <Bell size={18} />
                {me.unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-loss px-1 text-center text-[0.65rem] font-bold text-white">{me.unread > 9 ? "9+" : me.unread}</span>}
              </Link>
            )}
            {siteAdmin && (
              <Link href="/dashboard" className="hidden items-center gap-1 text-xs text-ink-muted hover:text-ink sm:flex">
                <ArrowLeft size={14} /> Admin site
              </Link>
            )}
            {signedIn ? (
              <button type="button" onClick={() => signOut.mutate()} className="rounded-md p-1.5 text-ink-muted hover:text-ink" aria-label="Sign out">
                <LogOut size={18} />
              </button>
            ) : (
              // Only once we know nobody is signed in (not while the page is still loading).
              !isPending && pathname !== "/members/login" && (
                <Link href="/members/login" className="text-xs font-medium text-accent">
                  Sign in
                </Link>
              )
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1">
        {signedIn && (
          <nav aria-label="Members" className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-line px-3 py-4 lg:block">
            <ul className="space-y-0.5">
              {MEMBERS_NAV.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive(href) ? "bg-surface-2 font-medium text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}
                  >
                    <Icon size={17} className={isActive(href) ? "text-accent" : ""} />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
            {siteAdmin && (
              <Link href="/dashboard" className="mt-6 flex items-center gap-2 px-3 text-xs text-ink-muted hover:text-ink">
                <ArrowLeft size={14} /> Back to the admin site
              </Link>
            )}
          </nav>
        )}
        <main className="min-w-0 flex-1 px-4 py-5 pb-[calc(80px+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-10">{children}</main>
      </div>

      {signedIn && (
        <nav aria-label="Members" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <ul className="mx-auto flex max-w-md">
            {MEMBERS_NAV.filter((n) => n.mobile).map(({ href, short, icon: Icon }) => (
              <li key={href} className="flex-1">
                <Link href={href} aria-current={isActive(href) ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[0.72rem] ${isActive(href) ? "text-accent" : "text-ink-muted"}`}>
                  <Icon size={20} />
                  {short}
                </Link>
              </li>
            ))}
            <li className="flex-1">
              <button type="button" onClick={() => setMore(true)} className="flex w-full flex-col items-center gap-0.5 py-2 text-[0.72rem] text-ink-muted">
                <MoreHorizontal size={20} />
                More
              </button>
            </li>
          </ul>
        </nav>
      )}

      {more && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setMore(false)}>
          <div role="dialog" aria-label="More members pages" className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Members</p>
              <button type="button" onClick={() => setMore(false)} aria-label="Close" className="p-1 text-ink-muted">
                <X size={18} />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {MEMBERS_NAV.filter((n) => !n.mobile).map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} onClick={() => setMore(false)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-3 text-sm text-ink">
                    <Icon size={16} className="text-accent" />
                    {label}
                  </Link>
                </li>
              ))}
              {siteAdmin && (
                <li className="col-span-2">
                  <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-3 text-sm text-ink-muted">
                    <ArrowLeft size={16} /> Back to the admin site
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
