"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "@/components/nav/BottomNav";
import { useUiStore } from "@/state/ui.store";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const setLastMoreRoute = useUiStore((s) => s.setLastMoreRoute);

  // Remember where under /more the user last was (but never remember an
  // admin route as the "return to" target — always land back on the More
  // menu for that, not mid-way into a gated page).
  useEffect(() => {
    if (pathname.startsWith("/more") && !pathname.startsWith("/more/admin")) {
      setLastMoreRoute(pathname);
    }
  }, [pathname, setLastMoreRoute]);

  return (
    <div className="flex min-h-dvh flex-col bg-app text-ink">
      <main className="flex-1 overflow-y-auto pb-[calc(64px+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
