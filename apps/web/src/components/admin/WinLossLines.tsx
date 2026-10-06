"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbp } from "@/lib/format";

export interface LineSeries {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
}

export { gbp };

function LinesTooltip({
  active,
  label,
  payload,
  series,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  series: LineSeries[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="max-w-[220px] rounded-lg border border-line bg-surface px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-medium text-ink">{label}</p>
      <ul className="space-y-0.5">
        {series.map((s) => {
          const v = payload.find((p) => p.dataKey === s.key)?.value;
          return (
            <li key={s.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="tabular-nums text-ink">{typeof v === "number" ? gbp(v) : "\u2013"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Straight-line cumulative profit/loss chart, with a zero line and a small colour key. */
export function WinLossLines({ data, series }: { data: Array<Record<string, number | string>>; series: LineSeries[] }) {
  // One line gets a soft fade beneath it (the line's colour at the top, nothing at the bottom); several lines would
  // just smear over each other, so they stay plain.
  const filled = series.length === 1;
  return (
    <>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            {filled && (
              <defs>
                <linearGradient id="winloss-fade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={series[0]!.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={series[0]!.color} stopOpacity={0} />
                </linearGradient>
              </defs>
            )}
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v < 0 ? "\u2212" : ""}\u00a3${Math.abs(v)}`}
              width={52}
            />
            <ReferenceLine y={0} stroke="var(--ink-muted)" strokeOpacity={0.5} />
            <Tooltip cursor={{ stroke: "var(--line)" }} content={(p) => <LinesTooltip active={p.active} label={p.label} payload={p.payload} series={series} />} />
            {filled && (
              <Area type="linear" dataKey={series[0]!.key} baseValue={0} stroke="none" fill="url(#winloss-fade)" isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={data.length <= 14 ? { r: 2.5, fill: s.color } : false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
      </ul>
    </>
  );
}
