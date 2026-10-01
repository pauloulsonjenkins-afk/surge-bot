"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "@/components/nav/BottomNav";
import SideNav from "@/components/nav/SideNav";
import { useUiStore } from "@/state/ui.store";
import { isValidMoreRoute } from "@/lib/routes";

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

  // Pages full of charts get more room on wide screens; lists and forms read best at a narrower width.
  const wide = pathname.startsWith("/dashboard") || pathname.startsWith("/more/admin/winloss") || pathname.startsWith("/more/admin/horses");

  return (
    <div className="flex min-h-dvh flex-col bg-app text-ink">
      <SideNav />
      <main className="flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom,0px))] lg:pb-10 lg:pl-60">
        <div className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-3xl"} lg:pt-4`}>{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}