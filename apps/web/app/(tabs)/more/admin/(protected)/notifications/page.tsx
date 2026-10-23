"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { getJson } from "@/queries/fetch-json";
import type { SentNotification } from "@/server/engine-client";

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** The kinds worth filtering by, from each notification's title. */
const KINDS: Array<{ value: string; label: string; test: (n: SentNotification) => boolean }> = [
  { value: "all", label: "All", test: () => true },
  { value: "suggest", label: "Suggestions", test: (n) => /suggestion|stake (raised|lowered)|golden finder|proved golden|golden again|badge lost|switched to sim/i.test(n.title) },
  { value: "golden", label: "Golden alerts", test: (n) => /^golden alert/i.test(n.title) },
  { value: "betting", label: "Betting", test: (n) => /not placed|picks not placed|betting (paused|resumed)|loss stop/i.test(n.title) },
  { value: "results", label: "Results", test: (n) => /result|summary|today/i.test(n.title) },
];

/** Every notification GoalBrew sent you in the last 60 days, newest first, grouped by day. */
export default function NotificationsPage() {
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: ({ signal }) => getJson<{ notifications: SentNotification[] }>("/api/admin/notifications", "the notifications", signal),
    refetchInterval: 60_000,
  });
  const [kind, setKind] = useState("all");
  const days = useMemo(() => {
    const test = KINDS.find((k) => k.value === kind)!.test;
    const out = new Map<string, SentNotification[]>();
    for (const n of (q.data?.notifications ?? []).filter(test)) {
      const d = day.format(new Date(n.at));
      out.set(d, [...(out.get(d) ?? []), n]);
    }
    return [...out.entries()];
  }, [q.data, kind]);

  return (
    <div className="space-y-4">
      <PageHeader as="h2" title="Notifications" subtitle="Everything GoalBrew sent to your phone in the last 60 days, newest first. Tap one to open its page." />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${kind === k.value ? "bg-accent text-accent-ink" : "border border-line text-ink hover:bg-surface-2"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {q.error ? (
        <QueryError error={q.error} next="/more/admin/notifications" />
      ) : q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : days.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing yet. Notifications are kept from 24 Oct 2026 on.</p>
      ) : (
        days.map(([d, list]) => (
          <section key={d} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{d}</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {list.map((n) => {
                const inner = (
                  <>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{n.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">{time.format(new Date(n.at))}</span>
                    </span>
                    <span className="mt-0.5 block whitespace-pre-line text-xs text-ink-muted">{n.body}</span>
                    {n.reached === 0 && <span className="mt-0.5 block text-xs text-warn">Not delivered to any device.</span>}
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.url ? (
                      <Link href={n.url} className="block px-3 py-2.5 hover:bg-surface-2">
                        {inner}
                      </Link>
                    ) : (
                      <div className="px-3 py-2.5">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
