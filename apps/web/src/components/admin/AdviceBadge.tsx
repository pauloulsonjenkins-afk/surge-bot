"use client";

import { useAdviceCount } from "@/queries/use-today";

/** The number of strategy suggestions waiting, beside the Strategies link in the menus; nothing when there are none. */
export function AdviceBadge({ href }: { href: string }) {
  if (href !== "/more/admin/strategies") return null;
  return <Count />;
}

function Count() {
  const n = useAdviceCount();
  if (n === 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold leading-5 text-accent-ink" aria-label={`${n} suggestion${n === 1 ? "" : "s"}`}>
      {n}
    </span>
  );
}
