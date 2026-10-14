"use client";

/**
 * An admin page made of tabs, each one a whole view (e.g. Betting: Bets placed · Limits and switches · Betfair check).
 * The tab is in the address (?tab=), so a link, a bookmark or a redirect from an old page opens the right one, and
 * Back works. The first tab is the default and has no ?tab=.
 */
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface PageTab {
  id: string;
  label: string;
  render: () => React.ReactNode;
}

function Tabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const asked = useSearchParams().get("tab");
  const current = tabs.find((t) => t.id === asked) ?? tabs[0]!;
  const choose = (id: string) => router.replace(id === tabs[0]!.id ? pathname : `${pathname}?tab=${id}`, { scroll: false });
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={label} className="flex gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === current.id}
            onClick={() => choose(t.id)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              t.id === current.id ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={current.label}>
        {current.render()}
      </div>
    </div>
  );
}

export function TabbedPage({ tabs, label }: { tabs: PageTab[]; label: string }) {
  return (
    <Suspense>
      <Tabs tabs={tabs} label={label} />
    </Suspense>
  );
}
