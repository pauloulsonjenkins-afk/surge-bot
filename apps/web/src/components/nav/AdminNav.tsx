"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS } from "@/lib/admin-sections";

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
    <nav ref={navRef} aria-label="Admin" className="relative flex gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden">
      {ADMIN_SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
              active ? "bg-accent font-medium text-accent-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
