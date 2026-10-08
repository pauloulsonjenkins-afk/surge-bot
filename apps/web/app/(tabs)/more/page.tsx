"use client";

import { PageHeader } from "@/components/ui/Card";
import Link from "next/link";
import { Bot, ChevronRight, Crown, ListChecks, Lock, PencilLine, Scale, Send, Settings, TrendingUp, Trophy } from "lucide-react";
import { HorseHeadIcon } from "@/components/ui/HorseHeadIcon";
import AccountCard from "@/components/account/AccountCard";
import { ADMIN_GROUPS } from "@/lib/admin-sections";
import { useMe } from "@/queries/use-me";

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  "/more/admin/sending": Send,
  "/more/admin/strategies": Bot,
  "/more/admin/leagues": Trophy,
  "/more/admin/winloss": TrendingUp,
  "/more/admin/results": PencilLine,
  "/more/admin/reconcile": Scale,
  "/more/admin/horses": HorseHeadIcon,
  "/more/admin/horse-stats": TrendingUp,
  "/more/admin/horse-log": ListChecks,
  "/more/admin/members": Crown,
  "/more/admin/settings": Settings,
};

/** Your account, then (for the admin only) the admin pages. Everyone else gets a small way into the admin sign-in. */
export default function MorePage() {
  const { data: me } = useMe();

  return (
    <div className="space-y-6 px-4 py-4">
      <PageHeader title="More" />

      <AccountCard />

      {me?.admin &&
        ADMIN_GROUPS.map((g) => (
          <section key={g.label} className="space-y-3">
            <h2 className="text-base font-semibold text-ink">{g.label}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {g.items.map(({ href, label, description }) => {
                const Icon = ICONS[href] ?? Bot;
                return (
                  <li key={href}>
                    <Link href={href} className="flex items-center gap-3 px-3 py-3 active:bg-surface-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-muted">
                        <Icon size={18} />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">{label}</span>
                        <span className="block text-xs text-ink-muted">{description}</span>
                      </span>
                      <ChevronRight size={16} className="text-ink-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

      {me && !me.admin && (
        <Link href="/more/admin/login" className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
          <Lock size={12} /> Admin sign in
        </Link>
      )}
    </div>
  );
}
