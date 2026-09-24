"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BotPerformance } from "@/domain/dashboard";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ChartCard } from "./ChartCard";
import { ChartTooltip, TooltipSeriesMeta } from "./ChartTooltip";
import { EmptyState } from "./EmptyState";
import { TrendChip } from "@/components/ui/TrendChip";
import { Skeleton } from "@/components/ui/Skeleton";

const BOT_COLOR = ["#E8A33D", "#5EA8FF", "#21C7A8", "#F472B6", "#A78BFA"];
function colorAt(i: number): string {
  return BOT_COLOR[i % BOT_COLOR.length] ?? "#8b93a1";
}

function tickInterval(len: number): number {
  return Math.max(0, Math.ceil(len / 6) - 1);
}

/** Reshapes each bot's own [{label, pnl}] series into one row-per-bucket dataset keyed by bot id. */
function mergeSeries(perf: BotPerformance[]): Array<Record<string, number | string>> {
  const length = perf[0]?.series.length ?? 0;
  return Array.from({ length }, (_, i) => {
    const row: Record<string, number | string> = { label: perf[0]?.series[i]?.label ?? "" };
    for (const p of perf) row[p.bot.id] = p.series[i]?.pnl ?? 0;
    return row;
  });
}

export function BotPerformanceChart({
  data,
  isLoading,
}: {
  data: BotPerformance[] | undefined;
  isLoading: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const merged = useMemo(() => (data ? mergeSeries(data) : []), [data]);
  const seriesMeta: Record<string, TooltipSeriesMeta> = useMemo(() => {
    if (!data) return {};
    const meta: Record<string, TooltipSeriesMeta> = {};
    data.forEach((p, i) => {
      meta[p.bot.id] = { label: p.bot.name, color: colorAt(i), format: (v) => formatCurrency(v, true) };
    });
    return meta;
  }, [data]);

  const anyTrades = !isLoading && data && data.some((p) => p.trades > 0);

  function toggle(botId: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(botId)) next.delete(botId);
      else next.add(botId);
      return next;
    });
  }

  return (
    <ChartCard title="Bot Performance" subtitle="Cumulative P&L per strategy — tap a name below to isolate it">
      {isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : !anyTrades ? (
        <EmptyState title="No bot activity yet" detail="Once your bots start settling bets, each strategy's cumulative P&L will overlay here." />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                interval={tickInterval(merged.length)}
              />
              <YAxis
                tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => formatCurrency(v)}
              />
              <Tooltip
                cursor={{ stroke: "var(--line)" }}
                content={(props) => <ChartTooltip {...(props as object)} series={seriesMeta} />}
              />
              {data!.map((p, i) => (
                <Line
                  key={p.bot.id}
                  type="monotone"
                  dataKey={p.bot.id}
                  stroke={colorAt(i)}
                  strokeWidth={2}
                  strokeOpacity={hidden.has(p.bot.id) ? 0 : 1}
                  dot={false}
                  activeDot={hidden.has(p.bot.id) ? false : { r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {!isLoading && data && (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {data.map((p, i) => (
            <li key={p.bot.id} className="flex items-center justify-between py-2 text-xs">
              <button
                type="button"
                onClick={() => toggle(p.bot.id)}
                className={`flex items-center gap-2 text-left ${hidden.has(p.bot.id) ? "opacity-40" : ""}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorAt(i) }} />
                <span className="text-ink">{p.bot.name}</span>
                {p.bot.status === "paused" && (
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-muted">Paused</span>
                )}
              </button>

              {p.trades === 0 ? (
                <span className="text-ink-muted">{p.bot.status === "paused" ? "Not trading" : "No trades this window"}</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-ink-muted">{formatPercent(p.roi)} ROI</span>
                  <span className="tabular-nums text-ink">{formatCurrency(p.totalPnl, true)}</span>
                  <TrendChip changePct={p.changePct} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
