"use client";

import Link from "next/link";
import { PencilLine } from "lucide-react";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { betText } from "@/lib/markets";
import { useMe } from "@/queries/use-me";
import { useLivePicks, type PublicPick as LivePick } from "@/queries/use-live";

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

function Row({ pick }: { pick: LivePick }) {
  const hit = pick.result === "hit";
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {pick.home ?? "Unknown"} <span className="text-ink-muted">v</span> {pick.away ?? "Unknown"}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {[pick.strategy.replace(/\([^)]*\)/g, "").trim(), betText(pick.market, pick.selection)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold ${hit ? "text-hit" : "text-loss"}`}>{hit ? "Hit" : "Miss"}</p>
        <p className="text-xs tabular-nums text-ink-muted">
          {pick.ftScore ?? "–"}
          {pick.resultOverridden && " · amended"}
        </p>
      </div>
    </li>
  );
}

export default function TradeLogPage() {
  const { data, isLoading, error } = useLivePicks(200);
  const { data: me } = useMe();

  if (isLoading) return <ListSkeleton />;

  const settled = (data ?? []).filter((p) => p.result === "hit" || p.result === "miss");

  // Group by UK day, newest first (the list already arrives newest first).
  const groups: Array<{ day: string; picks: LivePick[]; hits: number }> = [];
  for (const p of settled) {
    const day = dayFmt.format(new Date(p.firstSeenAt));
    let last = groups[groups.length - 1];
    if (!last || last.day !== day) {
      last = { day, picks: [], hits: 0 };
      groups.push(last);
    }
    last.picks.push(p);
    if (p.result === "hit") last.hits += 1;
  }

  return (
    <div className="space-y-6 px-4 py-4">
      <PageHeader
        title="Trade Log"
        subtitle="Every settled pick, most recent first"
        actions={
          me?.admin ? (
            <Link
              href="/more/admin/results"
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink"
            >
              <PencilLine size={14} />
              Amend results
            </Link>
          ) : undefined
        }
      />

      {error ? (
        <QueryError error={error} next="/trade-log" />
      ) : settled.length === 0 ? (
        <EmptyState title="No settled picks yet" detail="Results appear here once matches finish." />
      ) : (
        groups.map((g) => {
          const misses = g.picks.length - g.hits;
          return (
            <section key={g.day} className="space-y-3">
              <h2 className="flex items-baseline justify-between text-base font-semibold text-ink">
                {g.day}
                <span className="text-xs font-medium tabular-nums">
                  <span className="text-hit">{g.hits}</span>
                  <span className="text-ink-muted"> – </span>
                  <span className="text-loss">{misses}</span>
                  <span className="text-ink-muted"> · {Math.round((g.hits / g.picks.length) * 100)}%</span>
                </span>
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {g.picks.map((p) => (
                  <Row key={p.id} pick={p} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
