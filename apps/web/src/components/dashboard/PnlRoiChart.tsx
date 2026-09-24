"use client";

import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SeriesPoint } from "@/domain/dashboard";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ChartCard } from "./ChartCard";
import { ChartTooltip, TooltipSeriesMeta } from "./ChartTooltip";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

const SERIES = {
  pnl: { label: "Cumulative P&L", color: "var(--accent)", format: (v: number) => formatCurrency(v, true) },
  roi: { label: "ROI", color: "#5EA8FF", format: (v: number) => formatPercent(v) },
} satisfies Record<string, TooltipSeriesMeta>;

function tickInterval(len: number): number {
  return Math.max(0, Math.ceil(len / 6) - 1);
}

export function PnlRoiChart({
  series,
  isLoading,
}: {
  series: SeriesPoint[] | undefined;
  isLoading: boolean;
}) {
  const isEmpty = !isLoading && (!series || series.every((p) => p.pnl === 0 && p.roi === 0));

  return (
    <ChartCard
      title="Aggregate P&L & ROI"
      subtitle="Cumulative across all leagues and bots"
      actions={
        !isEmpty && (
          <div className="flex gap-3 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SERIES.pnl.color }} /> P&L
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SERIES.roi.color }} /> ROI
            </span>
          </div>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="h-52 w-full" />
      ) : isEmpty ? (
        <EmptyState title="No settled trades yet" detail="P&L and ROI will chart here once bots start settling bets in this window." />
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                interval={tickInterval(series!.length)}
              />
              <YAxis
                yAxisId="pnl"
                tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => formatCurrency(v)}
              />
              <YAxis
                yAxisId="roi"
                orientation="right"
                tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                cursor={{ stroke: "var(--line)" }}
                content={(props) => <ChartTooltip {...(props as object)} series={SERIES} />}
              />
              <Line
                yAxisId="pnl"
                type="monotone"
                dataKey="pnl"
                stroke={SERIES.pnl.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                yAxisId="roi"
                type="monotone"
                dataKey="roi"
                stroke={SERIES.roi.color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 3 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
