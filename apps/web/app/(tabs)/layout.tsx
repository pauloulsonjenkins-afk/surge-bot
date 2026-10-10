"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "@/components/nav/BottomNav";
import SideNav from "@/components/nav/SideNav";
import { useUiStore } from "@/state/ui.store";
import { isValidMoreRoute } from "@/lib/routes";
import Image from "next/image";
import Link from "next/link";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const setLastMoreRoute = useUiStore((s) => s.setLastMoreRoute);

  // Remember where under /more the user last was (but never remember an
  // admin route as the "return to" target — always land back on the More
  // menu for that, not mid-way into a gated page).
  useEffect(() => {
    if (isValidMoreRoute(pathname)) {
      setLastMoreRoute(pathname);
    }
  }, [pathname, setLastMoreRoute]);

  // Pages full of charts get more room on wide screens; lists and forms read best at a narrower width. Both start at the
  // same left edge, so moving between pages doesn't make the content jump sideways.
  const wide = pathname.startsWith("/dashboard") || pathname.startsWith("/more/admin/winloss") || pathname.startsWith("/more/admin/horses") || pathname.startsWith("/more/admin/horse-stats") || pathname.startsWith("/more/admin/horse-log") || pathname.startsWith("/more/admin/history") || pathname.startsWith("/more/admin/today") || pathname.startsWith("/more/admin/goal-model") || pathname.startsWith("/more/admin/edge");

  // The admin sign-in stands on its own: the site's tabs mean nothing until you're in.
  if (pathname === "/more/admin/login") {
    return (
      <div className="flex min-h-dvh flex-col bg-app text-ink">
        <header className="px-5 pt-5">
          <Link href="/members" aria-label="GoalBrew">
            <Image unoptimized priority src="/brand/goalbrew-logo-dark.svg" alt="GoalBrew" width={168} height={28} className="h-7 w-auto [[data-theme=light]_&]:hidden" />
            <Image unoptimized src="/brand/goalbrew-logo-light.svg" alt="GoalBrew" width={168} height={28} className="hidden h-7 w-auto [[data-theme=light]_&]:block" />
          </Link>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-app text-ink">
      <SideNav />
      <main className="flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom,0px))] lg:pb-10 lg:pl-60">
        <div className="mx-auto w-full max-w-5xl lg:pt-4">
          <div className={wide ? "" : "max-w-3xl"}>{children}</div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}