import Link from "next/link";
import { ShieldCheck, Layers, Bot, ChevronRight } from "lucide-react";

const ITEMS = [
  {
    href: "/more/admin/telegram",
    label: "Admin",
    description: "Telegram, staking, data feed and more — password protected.",
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
