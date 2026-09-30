"use client";

import { useMemo, useState } from "react";
import { Card, Segmented, ToggleChip } from "@/components/ui/Card";
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
  return <span className="ml-1 text-xs text-ink-muted">low n</span>;
}

/**
 * Hit rate by strategy, alert minute and league (grouped by country or tier), as tabs on one card.
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
  const [tab, setTab] = useState<"strategy" | "minute" | "league">("strategy");

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
    <div className="space-y-3">
      {filtered && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-muted">Showing</span>
          <span className="rounded-full bg-accent/15 px-2.5 py-0.5 font-medium text-ink">{filterLabel(leagueFilter, cells)}</span>
          {strategy && <span className="rounded-full bg-accent/15 px-2.5 py-0.5 font-medium text-ink">{strategy}</span>}
          <span className="tabular-nums text-ink-muted">
            · {pct(total)} from {total.settled} settled · {total.alerts} alerts
          </span>
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
      )}

      <Card
        title="Breakdown"
        subtitle={
          tab === "strategy"
            ? "Tap a strategy to filter the whole dashboard to it"
            : tab === "minute"
              ? "Hit rate by the match minute the alert fired"
              : "Tap a country, tier or league to filter this section"
        }
      >
        <Segmented
          label="Break down by"
          value={tab}
          onChange={setTab}
          className="mb-4"
          options={[
            { value: "strategy", label: "Strategy" },
            { value: "minute", label: "Minute" },
            { value: "league", label: "League" },
          ]}
        />
        {tab === "strategy" && (
          <ul className="divide-y divide-line">
            {strategyRows.map((r) => {
              const active = strategy === r.name;
              return (
                <li key={r.name}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onStrategyChange(strategy === r.name ? null : r.name)}
                    className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${
                      active ? "bg-accent/15" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{r.name}</span>
                      <span className="text-xs text-ink-muted">
                        {r.agg.alerts} alerts
                        {r.agg.lowSample && r.agg.alerts > 0 && <LowSample />}
                      </span>
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-ink">{pct(r.agg)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {tab === "minute" && (
          <ul className="space-y-3">
            {minuteRows.map((r, i) => {
              const best = i === bestMinute;
              const width = r.agg.hitRate === null ? 0 : Math.round(r.agg.hitRate * 100);
              return (
                <li key={r.label} className="text-sm">
                  <div className="flex justify-between text-ink">
                    <span className={best ? "font-semibold" : ""}>
                      {r.label}
                      {best && <span className="ml-2 text-xs font-normal text-ink-muted">best</span>}
                    </span>
                    <span className="tabular-nums">
                      {pct(r.agg)} <span className="text-xs text-ink-muted">· {r.agg.settled}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                    <div
                      className={`h-1.5 rounded-full ${best ? "bg-chart" : "bg-chart/40"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tab === "league" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                label="Group leagues by"
                value={grouping}
                onChange={changeGrouping}
                options={[
                  { value: "country", label: "Country" },
                  { value: "tier", label: "Tier" },
                ]}
              />
              {leagueCount > TOP_LEAGUES && (
                <ToggleChip checked={topOnly} onChange={setTopOnly}>
                  Top {TOP_LEAGUES} only{topOnly && ` · ${leagueCount - TOP_LEAGUES} hidden`}
                </ToggleChip>
              )}
            </div>

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
                    className={`flex w-full items-baseline justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      groupActive ? "bg-accent/15 text-ink shadow-[inset_2px_0_0_var(--accent)]" : "bg-surface-2 text-ink"
                    }`}
                  >
                    <span className="font-medium">{title}</span>
                    <span className="tabular-nums">
                      {pct(g.agg)} <span className="text-xs text-ink-muted">· {g.agg.alerts}</span>
                    </span>
                  </button>
                  <ul className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {g.rows.map((r) => {
                      const active = leagueFilter.type === "league" && leagueFilter.leagueId === r.leagueId;
                      return (
                        <li key={r.leagueId}>
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => pickLeagueFilter({ type: "league", leagueId: r.leagueId })}
                            style={active ? { background: TINT } : undefined}
                            className={`flex w-full items-baseline justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-sm text-ink transition-colors ${
                              active ? "border-accent" : "border-line"
                            }`}
                          >
                            <span className="min-w-0 truncate">{r.name}</span>
                            <span className="shrink-0 tabular-nums">
                              <span className="font-medium">{pct(r.agg)}</span>
                              {r.agg.lowSample && <LowSample />}
                              <span className="ml-1.5 text-xs text-ink-muted">
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
        )}
      </Card>
    </div>
  );
}