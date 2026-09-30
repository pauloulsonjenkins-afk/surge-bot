"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  return (
    <>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
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
          </LineChart>
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
