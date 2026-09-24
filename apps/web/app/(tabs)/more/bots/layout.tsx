"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUBTABS = [
  { href: "/more/bots", label: "Current" },
  { href: "/more/bots/new", label: "Create New" },
  { href: "/more/bots/roi", label: "ROI %" },
];

export default function BotsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <div className="px-4 pt-4">
        <h1 className="mb-3 text-lg font-medium tracking-tight text-ink">Bot Management</h1>
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {SUBTABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex-1 rounded-md py-1.5 text-center text-sm ${
                  active ? "bg-accent text-accent-ink" : "text-ink-muted"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}
