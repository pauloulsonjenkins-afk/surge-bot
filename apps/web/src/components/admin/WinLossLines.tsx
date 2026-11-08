"use client";

import { useId, useState } from "react";
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
  picked,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  series: LineSeries[];
  inUnits: boolean;
  /** The line the viewer tapped in the key: only it is listed. */
  picked: string | null;
}) {
  if (!active || !payload?.length) return null;
  const shown = picked ? series.filter((s) => s.key === picked) : series;
  return (
    <div className="max-w-[220px] rounded-lg border border-line bg-surface px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-medium text-ink">{label}</p>
      <ul className="space-y-0.5">
        {shown.map((s) => {
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
  selectable = false,
}: {
  data: Array<Record<string, number | string>>;
  series: LineSeries[];
  /** Values are units (flat 1-unit stake per bet), not £: the axis and tooltip say so. */
  inUnits?: boolean;
  /**
   * With several lines: the key under the chart becomes a list of buttons, each with its line's latest figure, best first.
   * Tapping one picks that line (thick, the others faded) and tapping it again shows them all (1 Nov 2026: twenty lines
   * on one chart were too hard to tell apart).
   */
  selectable?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [picked, setPicked] = useState<string | null>(null);
  const last = (key: string) => {
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i]?.[key];
      if (typeof v === "number") return v;
    }
    return 0;
  };
  const fmt = (v: number) => (inUnits ? units(v) : gbp(v));
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
            <Tooltip cursor={{ stroke: "var(--line)" }} content={(p) => <LinesTooltip active={p.active} label={p.label} payload={p.payload} series={series} inUnits={inUnits} picked={selectable ? picked : null} />} />
            {filled && (
              <Area type="linear" dataKey={series[0]!.key} baseValue={0} stroke="none" fill={`url(#${id}-fade)`} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={stroke ?? s.color}
                strokeWidth={selectable && picked === s.key ? 3.5 : 2}
                strokeOpacity={selectable && picked !== null && picked !== s.key ? 0.12 : 1}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={
                  selectable && picked !== null && picked !== s.key
                    ? false
                    : data.length > 14
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
      {selectable && series.length > 1 ? (
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {[...series]
            .sort((a, b) => last(b.key) - last(a.key))
            .map((s) => {
              const v = last(s.key);
              const on = picked === s.key;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? null : s.key)}
                    className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs ${on ? "bg-surface-2 ring-1 ring-inset ring-accent" : "hover:bg-surface-2"} ${picked !== null && !on ? "opacity-50" : ""}`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                    <span className={`shrink-0 tabular-nums ${v > 0 ? "text-hit" : v < 0 ? "text-loss" : "text-ink-muted"}`}>{fmt(v)}</span>
                  </button>
                </li>
              );
            })}
          {picked !== null && (
            <li className="sm:col-span-2">
              <button type="button" onClick={() => setPicked(null)} className="min-h-10 rounded-md border border-line px-3 text-xs font-medium text-ink">
                Show all lines
              </button>
            </li>
          )}
        </ul>
      ) : series.length > 1 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: keyColour ?? s.color }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
