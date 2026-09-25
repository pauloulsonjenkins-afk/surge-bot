import Link from "next/link";
import { ShieldCheck, Layers, Bot, ChevronRight } from "lucide-react";

const ITEMS = [
  {
    href: "/more/admin/telegram",
    label: "Admin",
    description: "Telegram, staking, data feed and more â€” password protected.",
    icon: ShieldCheck,
  },
  {
    href: "/more/accumulator",
    label: "Accumulator",
    description: "Combined-price and paper-traded accumulator tools.",
    icon: Layers,
  },
  {
    href: "/more/bots",
    label: "Bot Management",
    description: "Current bots, create new, and ROI tracking.",
    icon: Bot,
  },
];

export default function MorePage() {
  return (
    <div className="px-4 py-4">
      <h1 className="mb-4 text-lg font-medium tracking-tight text-ink">More</h1>

      <ul className="divide-y divide-line rounded-lg border border-line">
        {ITEMS.map(({ href, label, description, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 px-3 py-3 active:bg-surface-2"
            >
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
