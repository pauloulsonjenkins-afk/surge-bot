"use client";

import { useId, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbp, units } from "@/lib/format";
import { LOSS, ProfitGradients, profitSplit, profitStroke } from "@/components/charts/ProfitColours";

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

/**
 * Straight-line cumulative profit/loss chart, with a zero line.
 *
 * One line is green with a green gradient while in profit and red with a red gradient while in loss, changing exactly
 * at £0 (charts/ProfitColours.tsx), and its latest value is labelled at the end of the line, the figure you look for
 * first. Several lines keep their own colours, no fill, and a key underneath.
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
  const split = profitSplit(values);
  const stroke = filled ? profitStroke(id, split) : null;
  const keyColour = filled ? split.whole : null;
  const lastIndex = data.length - 1;
  const lastValue = values.at(-1) ?? 0;
  return (
    <>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: filled ? 22 : 8, right: 12, bottom: 0, left: -8 }}>
            {filled && (
              <defs>
                <ProfitGradients id={id} split={split} />
              </defs>
            )}
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--ink-muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={44}
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
              <Area type="linear" dataKey={series[0]!.key} baseValue={0} stroke="none" fill={`url(#${id}-fill)`} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={stroke ?? s.color}
                strokeWidth={selectable && picked === s.key ? 3.5 : filled ? 2.25 : 2}
                strokeOpacity={selectable && picked !== null && picked !== s.key ? 0.12 : 1}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={
                  selectable && picked !== null && picked !== s.key
                    ? false
                    : filled
                      ? (props: { cx?: number; cy?: number; index?: number }) =>
                          // Only the latest point: a dot ringed in the card colour, and its value above it.
                          props.index === lastIndex && props.cx !== undefined && props.cy !== undefined ? (
                            <g key="last">
                              <circle cx={props.cx} cy={props.cy} r={4.5} fill={lastValue < 0 ? LOSS : "var(--hit)"} stroke="var(--surface)" strokeWidth={2} />
                              <text x={props.cx - 2} y={props.cy - 10} textAnchor="end" fontSize={12} fontWeight={600} fill={lastValue < 0 ? LOSS : "var(--ink)"} className="tabular-nums">
                                {fmt(lastValue)}
                              </text>
                            </g>
                          ) : (
                            <g key={props.index} />
                          )
                      : data.length > 14
                        ? false
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
