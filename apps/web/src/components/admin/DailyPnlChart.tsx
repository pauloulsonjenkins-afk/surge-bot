"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbp } from "./WinLossLines";

const GAIN = "var(--hit)";
const LOSS = "var(--danger)";

export interface DailyBar {
  /** UK calendar date, YYYY-MM-DD. */
  date: string;
  pnl: number;
}

// "Sep 4" on the axis, like the picture this chart is modelled on; the tooltip and caption use UK wording.
const axisFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-09-04" -> "Sep 4" style label (the date is a plain calendar date, so no time zone shifts it). */
function label(date: string, fmt: Intl.DateTimeFormat): string {
  return fmt.format(new Date(`${date}T12:00:00Z`));
}

/** Everything the chart's caption needs, kept as a plain function so it can be checked on its own. */
export function summariseDays(days: DailyBar[]): { green: number; red: number; best: DailyBar | null; worst: DailyBar | null; total: number } {
  let green = 0;
  let red = 0;
  let best: DailyBar | null = null;
  let worst: DailyBar | null = null;
  let total = 0;
  for (const d of days) {
    total += d.pnl;
    if (d.pnl > 0) green++;
    else if (d.pnl < 0) red++;
    if (d.pnl > 0 && (best === null || d.pnl > best.pnl)) best = d;
    if (d.pnl < 0 && (worst === null || d.pnl < worst.pnl)) worst = d;
  }
  return { green, red, best, worst, total: Math.round(total * 100) / 100 };
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: DailyBar }> }) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-xl">
      <p className="text-[11px] font-medium text-ink">{label(d.date, longFmt)}</p>
      <p className={`text-xs tabular-nums ${d.pnl > 0 ? "text-hit" : d.pnl < 0 ? "text-danger" : "text-ink-muted"}`}>
        {d.pnl === 0 ? "£0.00" : gbp(d.pnl)}
      </p>
    </div>
  );
}

/** One bar per day: green above zero, red below, with a £ scale, like a trading app's daily P&L. */
export function DailyPnlChart({ days }: { days: DailyBar[] }) {
  const data = days.map((d) => ({ ...d, name: label(d.date, axisFmt) }));
  // About six date labels however many days there are, so they never run into each other.
  const labelEvery = Math.max(0, Math.ceil(data.length / 6) - 1);
  const s = summariseDays(days);

  return (
    <>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 340, height: 224 }}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap="18%">
            <XAxis
              dataKey="name"
              tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={labelEvery}
            />
            <YAxis
              tick={{ fill: "var(--ink-muted)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v < 0 ? "\u2212" : ""}\u00a3${Math.abs(v)}`}
              width={52}
            />
            <ReferenceLine y={0} stroke="var(--ink-muted)" strokeOpacity={0.5} />
            <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <DayTooltip active={p.active} payload={p.payload as never} />} />
            <Bar dataKey="pnl" radius={[4, 4, 4, 4]} maxBarSize={18} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.date} fill={d.pnl >= 0 ? GAIN : LOSS} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        {s.green} green day{s.green === 1 ? "" : "s"} · {s.red} red day{s.red === 1 ? "" : "s"}
        {s.best ? ` · best ${gbp(s.best.pnl)} (${label(s.best.date, shortFmt)})` : ""}
        {s.worst ? ` · worst ${gbp(s.worst.pnl)} (${label(s.worst.date, shortFmt)})` : ""}
      </p>
    </>
  );
}
