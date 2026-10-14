"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ADMIN_GROUPS, ADMIN_SECTIONS } from "@/lib/admin-sections";

const chip = (active: boolean) =>
  `shrink-0 rounded-md px-2 py-1.5 text-sm transition-colors ${
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

  return (
    <nav aria-label="Admin" className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2 py-2 lg:hidden">
      {daily.map((s) => (
        <Link key={s.href} href={s.href} aria-current={isOn(s.href) ? "page" : undefined} className={chip(isOn(s.href))}>
          {s.label}
        </Link>
      ))}
      <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      {other && (
        <Link href={other.href} aria-current="page" className={`${chip(true)} max-w-[4.75rem] truncate`}>
          {"short" in other ? other.short : other.label}
        </Link>
      )}
      <Link href="/more" className="flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
        More <ChevronRight size={14} aria-hidden />
      </Link>
    </nav>
  );
}
