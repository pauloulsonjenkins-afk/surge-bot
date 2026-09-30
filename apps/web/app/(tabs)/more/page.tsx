import { PageHeader } from "@/components/ui/Card";
import Link from "next/link";
import { Bot, ChevronRight, ClipboardList, Send, TrendingUp, Trophy } from "lucide-react";
import AccountCard from "@/components/account/AccountCard";

// All password protected: each opens the admin area (asking for the admin password if needed).
const ITEMS = [
  { href: "/more/admin/results", label: "Results", description: "Settled alerts by day, with hits and misses.", icon: ClipboardList },
  { href: "/more/admin/sending", label: "Sending", description: "What is sent to your betting software, and stakes.", icon: Send },
  { href: "/more/admin/winloss", label: "Win/Loss", description: "Estimated profit and loss by day and strategy.", icon: TrendingUp },
  { href: "/more/admin/leagues", label: "Leagues", description: "Hide leagues, reset stats, set country and tier.", icon: Trophy },
  { href: "/more/admin/strategies", label: "Strategies", description: "Hit rate for each strategy, merge or delete.", icon: Bot },
];

export default function MorePage() {
  return (
    <div className="px-4 py-4">
      <div className="mb-4"><PageHeader title="More" /></div>

      <AccountCard />

      <ul className="divide-y divide-line rounded-lg border border-line">
        {ITEMS.map(({ href, label, description, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-3 py-3 active:bg-surface-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent">
                <Icon size={18} />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">{label}</span>
                <span className="block text-xs text-ink-muted">{description}</span>
              </span>
              <ChevronRight size={16} className="text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
