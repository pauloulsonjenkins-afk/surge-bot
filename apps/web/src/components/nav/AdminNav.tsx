"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ADMIN_GROUPS, ADMIN_SECTIONS } from "@/lib/admin-sections";
import { AdviceBadge } from "@/components/admin/AdviceBadge";

// On a touch screen each tab is 44px tall, the size a finger hits reliably (32px before).
const tap = "[@media(pointer:coarse)]:min-h-11";
const chip = (active: boolean) =>
  `inline-flex shrink-0 items-center rounded-md px-2 py-1.5 text-sm transition-colors ${tap} ${
    active ? "bg-accent/15 font-medium text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
  }`;

/**
 * The admin menu on phones and tablets: the everyday pages only, so it fits without scrolling, then "More admin"
 * (the More page lists every group). When an occasional page is open, its name (or short name) shows too, so you can
 * see where you are; it is held to the width that still leaves "More" on a phone.
 */
export default function AdminNav() {
  const pathname = usePathname();
  const isOn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const daily = ADMIN_GROUPS.filter((g) => g.daily).flatMap((g) => g.items);
  const other = ADMIN_SECTIONS.find((s) => isOn(s.href) && !daily.some((d) => d.href === s.href));
  const ref = useRef<HTMLElement>(null);
  // More tabs to the right than fit: a fade at that edge says so (the later ones, Report and More, were easy to miss).
  const [more, setMore] = useState(false);
  const check = () => {
    const el = ref.current;
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  };
  // The page you are on is brought into view, not left off the edge.
  useEffect(() => {
    const el = ref.current;
    const on = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && on) el.scrollTo({ left: on.offsetLeft - el.clientWidth / 2 + on.offsetWidth / 2, behavior: "auto" });
    check();
  }, [pathname]);

  return (
    <div className="relative lg:hidden">
    <nav ref={ref} onScroll={check} aria-label="Admin" className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-2">
      {daily.map((s) => (
        <Link key={s.href} href={s.href} aria-current={isOn(s.href) ? "page" : undefined} className={chip(isOn(s.href))}>
          {s.label}
          <AdviceBadge href={s.href} />
        </Link>
      ))}
      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      {other && (
        <Link href={other.href} aria-current="page" className={`${chip(true)} max-w-[4.75rem]`}>
          {/* The tab is a flex box now, so the "…" goes on the text inside it. */}
          <span className="truncate">{"short" in other ? other.short : other.label}</span>
        </Link>
      )}
      <Link href="/more" className={`flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1.5 text-sm ${tap} text-ink-muted hover:bg-surface-2 hover:text-ink`}>
        More <ChevronRight size={14} aria-hidden />
      </Link>
    </nav>
    {more && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--app)] to-transparent" />}
    </div>
  );
}
