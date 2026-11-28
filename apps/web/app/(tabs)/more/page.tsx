"use client";

import { PageHeader } from "@/components/ui/Card";
import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import { ADMIN_MORE } from "@/lib/admin-sections";
import { navIcon } from "@/components/nav/nav-icons";
import { useMe } from "@/queries/use-me";
import { useSending } from "@/queries/use-sending";

/** The betting switch at a glance, from the figures Home already keeps: read once on opening, never polled from here. */
function BettingStatus() {
  const { data } = useSending(0);
  const s = data?.settings;
  if (!s) return null;
  const live = Object.values(s.strategies).filter(Boolean).length;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.enabled ? "bg-hit/15 text-hit" : "bg-surface-2 text-ink-muted"}`}>
      {s.enabled ? `On · ${live} Real money` : "Off"}
    </span>
  );
}

/**
 * For the admin only, the pages that aren't on the tab bar: six of them (14 Nov 2026). It was 17
 * rows in five groups, five of them already on the bar; Golden, the Report, the notification log, Fix a result and the
 * Archive now open as tabs under the page they belong to. Everyone else gets a small way into the admin sign-in.
 */
export default function MorePage() {
  const { data: me } = useMe();

  return (
    <div className="space-y-6 px-4 py-4">
      <PageHeader title="More" />

      {me?.admin && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {ADMIN_MORE.map(({ href, label, description }) => {
            const Icon = navIcon(href);
            return (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 px-3 py-3.5 active:bg-surface-2">
                  <span className="icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                    <Icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      {label}
                      {href.endsWith("/sending") && <BettingStatus />}
                    </span>
                    <span className="block text-xs text-ink-muted">{description}</span>
                  </span>
                  <ChevronRight size={16} className="text-ink-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {me && !me.admin && (
        <Link href="/more/admin/login" className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
          <Lock size={12} /> Admin sign in
        </Link>
      )}
    </div>
  );
}
