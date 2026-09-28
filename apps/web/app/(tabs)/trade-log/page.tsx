"use client";

import { EmptyState } from "@/components/dashboard/EmptyState";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";
import { marketName } from "@/lib/markets";
import { useLivePicks, type PublicPick as LivePick } from "@/queries/use-live";

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

function Row({ pick }: { pick: LivePick }) {
  const hit = pick.result === "hit";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {pick.home ?? "Unknown"} v {pick.away ?? "Unknown"}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {[pick.strategy.replace(/\([^)]*\)/g, "").trim(), marketName(pick.market), pick.selection]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-xs font-medium ${hit ? "text-hit" : "text-danger"}`}>{hit ? "Hit" : "Miss"}</p>
        <p className="text-[11px] tabular-nums text-ink-muted">{pick.ftScore ?? "–"}</p>
        {pick.resultOverridden && <p className="text-[10px] text-ink-muted">amended</p>}
      </div>
    </li>
  );
}

export default function TradeLogPage() {
  const { data, isLoading, error } = useLivePicks(200);

  if (isLoading) return <ListSkeleton />;

  const settled = (data ?? []).filter((p) => p.result === "hit" || p.result === "miss");

  // Group by UK day, newest first (the list already arrives newest first).
  const groups: Array<{ day: string; picks: LivePick[] }> = [];
  for (const p of settled) {
    const day = dayFmt.format(new Date(p.firstSeenAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.picks.push(p);
    else groups.push({ day, picks: [p] });
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h1 className="text-lg font-medium tracking-tight text-ink">Trade Log</h1>
        <p className="text-xs text-ink-muted">Settled picks, most recent first</p>
      </div>

      {error ? (
        <QueryError error={error} next="/trade-log" />
      ) : settled.length === 0 ? (
        <EmptyState title="No settled picks yet" detail="Results appear here once matches finish." />
      ) : (
        groups.map((g) => (
          <section key={g.day} className="space-y-1.5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{g.day}</h2>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {g.picks.map((p) => (
                <Row key={p.id} pick={p} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
