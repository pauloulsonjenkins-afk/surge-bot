"use client";

import { useId } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbp, units } from "@/lib/format";

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
  inUnits,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  series: LineSeries[];
  inUnits: boolean;
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
              <span className="tabular-nums text-ink">{typeof v === "number" ? (inUnits ? units(v) : gbp(v)) : "\u2013"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const UP = "var(--hit)";
const DOWN = "var(--loss)";

/**
 * Straight-line cumulative profit/loss chart, with a zero line and a small colour key.
 *
 * One line is coloured by where it is: green, with a green fade down to £0, while in profit, and red, with a red fade
 * up to £0, while in loss, so a spell below zero shows even in a period that finished up. Several lines keep their own
 * colours and no fade (they would smear over each other).
 */
export function WinLossLines({
  data,
  series,
  inUnits = false,
}: {
  data: Array<Record<string, number | string>>;
  series: LineSeries[];
  /** Values are units (flat 1-unit stake per bet), not £: the axis and tooltip say so. */
  inUnits?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const filled = series.length === 1;
  const values = filled ? data.map((d) => d[series[0]!.key]).filter((v): v is number => typeof v === "number") : [];
  const hi = values.length ? Math.max(...values) : 0;
  const lo = values.length ? Math.min(...values) : 0;
  // Where £0 falls, from the top (0) to the bottom (1): of the line's own range (stroke), and of the range down to or up
  // to £0 (the fade, which is drawn between the line and £0).
  // £0 itself counts as in profit (green): the split sits a hair below the zero line, so a flat £0 start isn't red.
  const crosses = hi >= 0 && lo < 0;
  const lineSplit = crosses ? Math.min(1, hi / (hi - lo) + 0.01) : 1;
  const fillTop = Math.max(hi, 0);
  const fillBottom = Math.min(lo, 0);
  const fillSplit = fillTop - fillBottom > 0 ? fillTop / (fillTop - fillBottom) : 1;
  const whole = lo >= 0 ? UP : DOWN; // used only when the line doesn't cross £0
  const stroke = filled ? (crosses ? `url(#${id}-stroke)` : whole) : null;
  const keyColour = filled ? (values.at(-1) ?? 0) < 0 ? DOWN : UP : null;
  return (
    <>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            {filled && (
              <defs>
                {/* The line: green above £0, red below (a hard change exactly at £0). */}
                <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={lineSplit} stopColor={UP} />
                  <stop offset={lineSplit} stopColor={DOWN} />
                </linearGradient>
                {/* The fade: strongest away from £0, nothing at £0, green above and red below. */}
                <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={0} stopColor={UP} stopOpacity={fillSplit > 0 ? 0.32 : 0} />
                  <stop offset={fillSplit} stopColor={UP} stopOpacity={0.02} />
                  <stop offset={fillSplit} stopColor={DOWN} stopOpacity={0.02} />
                  <stop offset={1} stopColor={DOWN} stopOpacity={fillSplit < 1 ? 0.32 : 0} />
                </linearGradient>
              </defs>
            )}
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (inUnits ? `${v < 0 ? "\u2212" : ""}${Math.abs(v)}u` : `${v < 0 ? "\u2212" : ""}\u00a3${Math.abs(v)}`)}
              width={52}
            />
            <ReferenceLine y={0} stroke="var(--ink-muted)" strokeOpacity={0.5} />
            <Tooltip cursor={{ stroke: "var(--line)" }} content={(p) => <LinesTooltip active={p.active} label={p.label} payload={p.payload} series={series} inUnits={inUnits} />} />
            {filled && (
              <Area type="linear" dataKey={series[0]!.key} baseValue={0} stroke="none" fill={`url(#${id}-fade)`} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={stroke ?? s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={
                  data.length > 14
                    ? false
                    : filled
                      ? (props: { cx?: number; cy?: number; value?: unknown; index?: number }) => (
                          <circle key={props.index} cx={props.cx} cy={props.cy} r={2.5} fill={typeof props.value === "number" && props.value < 0 ? DOWN : UP} />
                        )
                      : { r: 2.5, fill: s.color }
                }
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: keyColour ?? s.color }} />
            {s.name}
          </li>
        ))}
      </ul>
    </>
  );
}
