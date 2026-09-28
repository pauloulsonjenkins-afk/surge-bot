import Link from "next/link";
import { ShieldCheck, Bot, ChevronRight } from "lucide-react";

const ITEMS = [
  {
    href: "/more/bots",
    label: "Strategies",
    description: "Hit rate and activity for each strategy.",
    icon: Bot,
  },
  {
    href: "/more/admin/telegram",
    label: "Admin",
    description: "Telegram connection and received picks — password protected.",
    icon: ShieldCheck,
  },
];

export default function MorePage() {
  return (
    <div className="px-4 py-4">
      <h1 className="mb-4 text-lg font-medium tracking-tight text-ink">More</h1>

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
