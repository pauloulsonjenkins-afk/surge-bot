"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_GROUPS } from "@/lib/admin-sections";

/** The admin menu on phones and tablets: a scrolling row of links, with the current page highlighted and scrolled into view. */
export default function AdminNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);

  // Scroll the row so the current page's link is in the middle (only the row moves, never the page).
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label="Admin" className="relative flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden">
      {ADMIN_GROUPS.map((g, gi) => (
        <div key={g.label} className="flex shrink-0 items-center gap-1">
          {/* A thin divider between the groups. */}
          {gi > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-line" />}
          {g.items.map((s) => {
            const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-accent/15 font-medium text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
