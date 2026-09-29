"use client";

import { useMemo, useState } from "react";
import { Grouping, LeagueFilter, MINUTE_BUCKETS, OTHER_COUNTRY, ResolvedCell, TIER_LABEL, TOP_LEAGUES } from "@/domain/performance";
import { Agg, aggregate, groupLeagues, matchesLeague } from "@/lib/performance/derive";

const TINT = "color-mix(in srgb, var(--accent) 14%, transparent)";

function pct(a: Agg): string {
  return a.hitRate === null ? "–" : `${Math.round(a.hitRate * 100)}%`;
}

function sameFilter(a: LeagueFilter, b: LeagueFilter): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "country" && b.type === "country") return a.country === b.country;
  if (a.type === "tier" && b.type === "tier") return a.tier === b.tier;
  if (a.type === "league" && b.type === "league") return a.leagueId === b.leagueId;
  return true;
}

function tierTitle(tier: number): string {
  return tier === 0 ? (TIER_LABEL[0] ?? "Other") : `Tier ${tier} · ${TIER_LABEL[tier] ?? ""}`;
}

function filterLabel(f: LeagueFilter, cells: ResolvedCell[]): string {
  switch (f.type) {
    case "all":
      return "All leagues";
    case "country":
      return f.country === OTHER_COUNTRY ? "Other leagues" : f.country;
    case "tier":
      return tierTitle(f.tier);
    case "league":
      return cells.find((a) => a.leagueId === f.leagueId)?.leagueName ?? "League";
  }
}

function LowSample() {
  return <span className="ml-1 text-[10px] text-ink-muted">low n</span>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

/**
 * Hit rate by league (grouped by country or tier), strategy and alert minute.
 * Tapping a country, tier, league or strategy re-filters everything on this section.
 */
export function PerformanceSection({
  cells,
  strategy,
  onStrategyChange,
}: {
  cells: ResolvedCell[];
  /** The strategy the whole dashboard is filtered to, or null for every strategy. */
  strategy: string | null;
  onStrategyChange: (strategy: string | null) => void;
}) {
  const [grouping, setGrouping] = useState<Grouping>("country");
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>({ type: "all" });
  const [topOnly, setTopOnly] = useState(true);

  const byStrategy = useMemo(() => (strategy ? cells.filter((a) => a.strategy === strategy) : cells), [cells, strategy]);
  const byLeague = useMemo(() => cells.filter((a) => matchesLeague(a, leagueFilter)), [cells, leagueFilter]);
  const scoped = useMemo(() => byLeague.filter((a) => (strategy ? a.strategy === strategy : true)), [byLeague, strategy]);
  const total = useMemo(() => aggregate(scoped), [scoped]);

  const strategyRows = useMemo(() => {
    const names = Array.from(new Set(cells.map((a) => a.strategy))).sort();
    return names.map((name) => ({ name, agg: aggregate(byLeague.filter((a) => a.strategy === name)) }));
  }, [cells, byLeague]);

  const minuteRows = useMemo(
    () =>
      MINUTE_BUCKETS.map((b, i) => ({
        label: b.label,
        agg: aggregate(scoped.filter((a) => a.bucket === i)),
      })),
    [scoped],
  );
  const bestMinute = useMemo(() => {
    let best = -1;
    let bestRate = -1;
    minuteRows.forEach((r, i) => {
      if (r.agg.hitRate !== null && r.agg.settled >= 8 && r.agg.hitRate > bestRate) {
        best = i;
        bestRate = r.agg.hitRate;
      }
    });
    return best;
  }, [minuteRows]);

  const groups = useMemo(() => groupLeagues(byStrategy, grouping), [byStrategy, grouping]);

  // The busiest leagues by settled alerts. Ranked on everything, not the current filters, so the list doesn't reshuffle.
  const { topIds, leagueCount } = useMemo(() => {
    const totals = new Map<string, { settled: number; alerts: number }>();
    for (const c of cells) {
      const t = totals.get(c.leagueId) ?? { settled: 0, alerts: 0 };
      t.settled += c.hits + c.misses;
      t.alerts += c.alerts;
      totals.set(c.leagueId, t);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1].settled - a[1].settled || b[1].alerts - a[1].alerts);
    return { topIds: new Set(ranked.slice(0, TOP_LEAGUES).map(([id]) => id)), leagueCount: ranked.length };
  }, [cells]);
  const limiting = topOnly && leagueCount > TOP_LEAGUES;
  const shownGroups = useMemo(() => {
    if (!limiting) return groups;
    const activeId = leagueFilter.type === "league" ? leagueFilter.leagueId : null;
    return groups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => topIds.has(r.leagueId) || r.leagueId === activeId) }))
      .filter((g) => g.rows.length > 0);
  }, [groups, limiting, topIds, leagueFilter]);
  const filtered = leagueFilter.type !== "all" || strategy !== null;

  function pickLeagueFilter(next: LeagueFilter) {
    setLeagueFilter((cur) => (sameFilter(cur, next) ? { type: "all" } : next));
  }

  function changeGrouping(next: Grouping) {
    setGrouping(next);
    if (leagueFilter.type === "country" || leagueFilter.type === "tier") setLeagueFilter({ type: "all" });
  }

  return (
    <div className="space-y-4">
      {filtered && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-muted">Showing</span>
            <span className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-ink">
              {filterLabel(leagueFilter, cells)}
            </span>
            {strategy && <span className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-ink">{strategy}</span>}
            <button
              type="button"
              onClick={() => {
                setLeagueFilter({ type: "all" });
                onStrategyChange(null);
              }}
              className="ml-1 text-ink-muted underline"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-xs text-ink-muted">Hit rate</p>
              <p className="text-2xl font-medium tabular-nums text-ink">{pct(total)}</p>
              <p className="text-[11px] text-ink-muted">
                {total.hits} of {total.settled} settled
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-xs text-ink-muted">Alerts</p>
              <p className="text-2xl font-medium tabular-nums text-ink">{total.alerts}</p>
              <p className="text-[11px] text-ink-muted">{total.pending} still open</p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-ink">By league</h2>
            <p className="text-xs text-ink-muted">Tap a country, tier or league to filter this section</p>
            {leagueCount > TOP_LEAGUES && (
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={topOnly}
                  onChange={(e) => setTopOnly(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                  className="h-3.5 w-3.5"
                />
                <span>
                  Top {TOP_LEAGUES} leagues only
                  {topOnly && <span className="text-ink-muted"> · {leagueCount - TOP_LEAGUES} more hidden</span>}
                </span>
              </label>
            )}
          </div>
          <div role="tablist" aria-label="Group leagues by" className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
            {(["country", "tier"] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={grouping === g}
                onClick={() => changeGrouping(g)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  grouping === g ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {g === "country" ? "Country" : "Tier"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {shownGroups.map((g) => {
            const groupActive = sameFilter(leagueFilter, g.filter);
            const title =
              grouping === "tier" ? tierTitle(Number(g.key)) : g.key === OTHER_COUNTRY ? "Other leagues" : g.title;
            return (
              <div key={g.key}>
                <button
                  type="button"
                  aria-pressed={groupActive}
                  onClick={() => pickLeagueFilter(g.filter)}
                  className={`flex w-full items-baseline justify-between rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    groupActive ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
                  }`}
                >
                  <span className="font-medium">{title}</span>
                  <span className="tabular-nums">
                    {pct(g.agg)} <span className={groupActive ? "" : "text-ink-muted"}>· {g.agg.alerts}</span>
                  </span>
                </button>
                <ul className="mt-1 grid grid-cols-2 gap-1.5">
                  {g.rows.map((r) => {
                    const active = leagueFilter.type === "league" && leagueFilter.leagueId === r.leagueId;
                    return (
                      <li key={r.leagueId}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => pickLeagueFilter({ type: "league", leagueId: r.leagueId })}
                          style={active ? { background: TINT } : undefined}
                          className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs text-ink transition-colors ${
                            active ? "border-accent" : "border-line"
                          }`}
                        >
                          <span className="block truncate">{r.name}</span>
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-medium tabular-nums">
                              {pct(r.agg)}
                              {r.agg.lowSample && <LowSample />}
                            </span>
                            <span className="truncate text-[11px] text-ink-muted">
                              {grouping === "tier" ? r.country : `T${r.tier || "–"}`} · {r.agg.alerts}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5">
        <section className="rounded-xl border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-medium text-ink-muted">By strategy</h3>
          <ul className="space-y-1">
            {strategyRows.map((r) => {
              const active = strategy === r.name;
              return (
                <li key={r.name}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onStrategyChange(strategy === r.name ? null : r.name)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      active ? "bg-accent text-accent-ink" : "text-ink"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="leading-tight">{r.name}</span>
                      <span className="font-medium tabular-nums">{pct(r.agg)}</span>
                    </span>
                    <span className={`text-[11px] ${active ? "" : "text-ink-muted"}`}>
                      {r.agg.alerts} alerts
                      {r.agg.lowSample && r.agg.alerts > 0 && <LowSample />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-medium text-ink-muted">By alert minute</h3>
          <ul className="space-y-2">
            {minuteRows.map((r, i) => {
              const best = i === bestMinute;
              const width = r.agg.hitRate === null ? 0 : Math.round(r.agg.hitRate * 100);
              return (
                <li key={r.label} className="text-xs">
                  <div className="flex justify-between text-ink">
                    <span className={best ? "font-medium" : ""}>{r.label}</span>
                    <span className="tabular-nums">{pct(r.agg)}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-surface-2">
                    <div
                      className={`h-1.5 rounded-full ${best ? "bg-accent" : "bg-ink-muted opacity-50"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-ink-muted">Tap a strategy to filter the whole dashboard to it.</p>
        </section>
      </div>
    </div>
  );
}
