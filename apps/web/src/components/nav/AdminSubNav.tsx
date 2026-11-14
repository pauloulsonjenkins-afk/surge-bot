"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { familyOf } from "@/lib/admin-sections";
import { AdviceBadge } from "@/components/admin/AdviceBadge";

/**
 * The tabs along the top of a page that has others under it (lib/admin-sections.ts ADMIN_FAMILIES): Strategies has
 * Overview, Golden, Full detail and Archive; Profit has the Report; Settings has the notification log, Fix a result,
 * Free tips and Members. One line that scrolls sideways on a narrow phone. A single strategy's own page isn't a tab of
 * anything: it has its own "back to Strategies" link, so nothing is shown there.
 */
export default function AdminSubNav() {
  const pathname = usePathname();
  const found = familyOf(pathname);
  if (!found || !found.tab) return null;
  const { family, tab } = found;
  // Deeper than the tab itself (/strategies/<name>): that page has its own way back.
  if (pathname !== tab.href) return null;

  return (
    <nav aria-label="Pages in this section" className="chip-row mb-4 text-sm font-medium">
      {family.tabs.map((t) => {
        const active = t.href === tab.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 ${
              active ? "border-transparent bg-accent text-accent-ink" : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
            {!active && t.href === family.root && <AdviceBadge href={t.href} />}
          </Link>
        );
      })}
    </nav>
  );
}
