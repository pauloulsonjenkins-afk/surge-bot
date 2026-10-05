import { PageHeader } from "@/components/ui/Card";
import Link from "next/link";
import { Bot, ChevronRight, Crown, PencilLine, Scale, Send, Settings, TrendingUp, Trophy, Zap } from "lucide-react";
import { HorseHeadIcon } from "@/components/ui/HorseHeadIcon";
import AccountCard from "@/components/account/AccountCard";
import { ADMIN_GROUPS } from "@/lib/admin-sections";

const ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  "/more/admin/sending": Send,
  "/more/admin/direct": Zap,
  "/more/admin/strategies": Bot,
  "/more/admin/leagues": Trophy,
  "/more/admin/winloss": TrendingUp,
  "/more/admin/results": PencilLine,
  "/more/admin/reconcile": Scale,
  "/more/admin/horses": HorseHeadIcon,
  "/more/admin/members": Crown,
  "/more/admin/settings": Settings,
};

// All password protected: each opens the admin area (asking for the admin password if needed).
export default function MorePage() {
  return (
    <div className="space-y-6 px-4 py-4">
      <PageHeader title="More" />

      <AccountCard />

      {ADMIN_GROUPS.map((g) => (
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
    </div>
  );
}
