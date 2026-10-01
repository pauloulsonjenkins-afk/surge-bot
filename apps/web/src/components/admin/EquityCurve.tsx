"use client";

import { Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStrategyEquity, type StrategyEquity } from "@/queries/use-strategies";
import type { PickMode } from "@/server/engine-client";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "./WinLossLines";

const whenFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

interface Row {
  n: number;
  at: string;
  total: number;
  profit: number;
  result: "hit" | "miss";
}

/** Where the biggest drawdown starts (the high point) and ends (the low after it), as indexes into rows. Rows start at £0. */
export function drawdownSpan(rows: Array<{ total: number }>): { peak: number; trough: number } | null {
  let peak = 0;
  let best: { peak: number; trough: number; size: number } | null = null;
  rows.forEach((r, i) => {
    if (r.total > rows[peak]!.total) peak = i;
    const size = rows[peak]!.total - r.total;
    if (size > 0 && (best === null || size > best.size)) best = { peak, trough: i, size };
  });
  return best;
}

function PointTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Row }> }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-ink">
        Pick {r.n} · {whenFmt.format(new Date(r.at))}
      </p>
      <p className="text-xs text-ink-muted">
        {r.result === "hit" ? "Hit" : "Miss"} <span className={r.profit >= 0 ? "text-hit" : "text-loss"}>{gbp(r.profit)}</span>
      </p>
      <p className="text-xs tabular-nums text-ink">Running total {r.total === 0 ? "£0.00" : gbp(r.total)}</p>
    </div>
  );
}

/** The figures a stop loss should be set from, read off the strategy's own history. */
export function RiskFigures({ summary }: { summary: StrategyEquity["summary"] }) {
  const items: Array<[string, string]> = [
    ["Max drawdown", summary.maxDrawdown ? `£${summary.maxDrawdown.toFixed(2)}` : "£0.00"],
    ["Longest losing run", `${summary.longestLosingRun ?? 0}`],
    ["Worst day", summary.worstDay ? `${gbp(summary.worstDay.profit)} (${dayFmt.format(new Date(`${summary.worstDay.day}T12:00:00Z`))})` : "–"],
    ["Most losses in one day, in a row", `${summary.worstDayRun ?? 0}`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-md bg-surface-2 px-2.5 py-1.5">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="font-medium tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Running profit pick by pick for one strategy, with its biggest drawdown marked. A single series, so no legend: the
 * card it sits in names the strategy. Hover (or tap) a point for the pick, its result and the running total.
 */
export function EquityCurve({ label, mode }: { label: string; mode: PickMode }) {
  const { data, isLoading, error } = useStrategyEquity(label, mode, true);

  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (isLoading || !data) return <Skeleton className="h-48 w-full" />;
  if (data.points.length === 0) return <p className="text-xs text-ink-muted">No priced picks yet in this mode, so there is no curve to draw.</p>;

  const rows: Row[] = [{ n: 0, at: data.points[0]!.at, total: 0, profit: 0, result: "hit" }, ...data.points.map((p, i) => ({ n: i + 1, ...p }))];
  const span = drawdownSpan(rows);
  const peak = span ? rows[span.peak] : undefined;
  const trough = span ? rows[span.trough] : undefined;

  return (
    <figure className="space-y-2">
      <div className="h-48 w-full" role="img" aria-label={`Running profit for ${label} over ${data.points.length} priced picks, ending at ${gbp(data.summary.profit)}`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 192 }}>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <XAxis dataKey="n" tick={{ fill: "var(--ink-muted)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v < 0 ? "−" : ""}£${Math.abs(v)}`}
              width={52}
            />
            <ReferenceLine y={0} stroke="var(--line)" />
            <Tooltip content={<PointTooltip />} cursor={{ stroke: "var(--ink-muted)", strokeDasharray: "3 3" }} />
            <Line type="linear" dataKey="total" stroke="var(--chart)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            {peak && <ReferenceDot x={peak.n} y={peak.total} r={4} fill="var(--surface)" stroke="var(--ink-muted)" strokeWidth={2} />}
            {trough && <ReferenceDot x={trough.n} y={trough.total} r={4} fill="var(--loss)" stroke="var(--surface)" strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-ink-muted">
        Running profit over {data.points.length} priced pick{data.points.length === 1 ? "" : "s"} (pick number along the bottom).
        {peak && trough && ` The biggest drawdown, £${data.summary.maxDrawdown?.toFixed(2)}, runs from the open dot (pick ${peak.n}) to the red dot (pick ${trough.n}).`}
      </figcaption>
      <RiskFigures summary={data.summary} />
    </figure>
  );
}
