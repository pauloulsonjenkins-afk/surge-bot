"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LEAGUES, LeagueBreakdown } from "@/domain/dashboard";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ChartCard } from "./ChartCard";
import { EmptyState } from "./EmptyState";
import { TrendChip } from "@/components/ui/TrendChip";
import { Skeleton } from "@/components/ui/Skeleton";

const LEAGUE_COLOR: Record<string, string> = {
  "Premier League": "#E8A33D",
  Bundesliga: "#F472B6",
  "Serie A": "#5EA8FF",
  "La Liga": "#21C7A8",
  "Ligue 1": "#A78BFA",
};

export function LeagueBreakdownChart({
  data,
  isLoading,
}: {
  data: LeagueBreakdown[] | undefined;
  isLoading: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(LEAGUES));

  const visible = useMemo(() => (data ?? []).filter((d) => selected.has(d.league)), [data, selected]);
  const noActivityAtAll = !isLoading && data && data.every((d) => d.trades === 0);
  const nothingSelected = !isLoading && data && selected.size === 0;

  function toggle(league: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(league)) next.delete(league);
      else next.add(league);
      return next;
    });
  }

  return (
    <ChartCard title="P&L by League" subtitle="Tap a league to include or exclude it">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LEAGUES.map((league) => {
          const active = selected.has(league);
          return (
            <button
              key={league}
              type="button"
              onClick={() => toggle(league)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? "border-line bg-surface-2 text-ink" : "border-line/60 text-ink-muted opacity-50"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: LEAGUE_COLOR[league] }} />
              {league}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : noActivityAtAll ? (
        <EmptyState title="No league activity yet" detail="P&L per league will appear once bots start settling bets." />
      ) : nothingSelected ? (
        <EmptyState title="No leagues selected" detail="Tap a league above to show it on the chart." />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visible} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="league"
                width={92}
                tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const first = payload[0];
                  if (!first) return null;
                  const row = first.payload as LeagueBreakdown;
                  return (
                    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-xl">
                      <p className="mb-1 text-[11px] font-medium text-ink">{row.league}</p>
                      {row.trades === 0 ? (
                        <p className="text-xs text-ink-muted">No trades in this window</p>
                      ) : (
                        <div className="space-y-0.5 text-xs text-ink-muted">
                          <p>
                            P&L <span className="font-medium tabular-nums text-ink">{formatCurrency(row.pnl, true)}</span>
                          </p>
                          <p>
                            Win rate <span className="font-medium tabular-nums text-ink">{formatPercent(row.winRate * 100, 0)}</span>
                          </p>
                          <p>
                            Trades <span className="font-medium tabular-nums text-ink">{row.trades}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Bar dataKey="pnl" radius={[0, 4, 4, 0]} barSize={16}>
                {visible.map((row) => (
                  <Cell
                    key={row.league}
                    fill={row.trades === 0 ? "var(--line)" : LEAGUE_COLOR[row.league]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!isLoading && visible.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {visible.map((row) => (
            <li key={row.league} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-ink-muted">{row.league}</span>
              <span className="flex items-center gap-2">
                {row.trades === 0 ? (
                  <span className="text-ink-muted">No trades</span>
                ) : (
                  <>
                    <span className="tabular-nums text-ink">{formatCurrency(row.pnl, true)}</span>
                    <TrendChip changePct={row.changePct} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
