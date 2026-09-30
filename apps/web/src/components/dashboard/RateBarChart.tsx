"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HitRateRow } from "@/queries/use-stats";
import { EmptyState } from "./EmptyState";

/** Bars drawn faded until a row has this many settled picks, so a 100% from two picks doesn't look solid. */
const SOLID_FROM = 10;

interface Datum {
  label: string;
  /** Length of the bar. A true 0% is drawn as a sliver so recharts still places its label. */
  value: number | null;
  /** The real hit rate, shown in the tooltip. */
  rate: number | null;
  hits: number;
  misses: number;
  settled: number;
}

/** "68%" on the bar, or nothing when the row has no settled picks. A 0% bar has no length, so the label is what shows it. */
function pctLabel(v: unknown): string {
  return typeof v === "number" ? `${Math.round(v)}%` : "";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function RateTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const row = payload?.[0]?.payload as Datum | undefined;
  if (!active || !row) return null;
  return (
    <div className="max-w-[220px] rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-medium text-ink">{row.label}</p>
      {row.settled === 0 ? (
        <p className="text-xs text-ink-muted">No settled picks yet</p>
      ) : (
        <div className="space-y-0.5 text-xs text-ink-muted">
          <p>
            Hit rate <span className="font-medium tabular-nums text-ink">{row.rate}%</span>
          </p>
          <p>
            <span className="tabular-nums text-ink">{row.hits}</span> hit{row.hits === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums text-ink">{row.misses}</span> miss{row.misses === 1 ? "" : "es"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Hit rate per row as bars. "bars" = horizontal (good for long names such as
 * strategies and leagues); "columns" = vertical (good for short ordered
 * labels such as minute buckets).
 */
export function RateBarChart({
  rows,
  layout,
  emptyDetail,
}: {
  rows: HitRateRow[];
  layout: "bars" | "columns";
  emptyDetail: string;
}) {
  const data: Datum[] = rows.map((r) => ({
    label: r.label,
    value: r.hitRate === 0 ? 0.01 : r.hitRate,
    rate: r.hitRate,
    hits: r.hits,
    misses: r.misses,
    settled: r.hits + r.misses,
  }));

  if (data.every((d) => d.settled === 0)) {
    return <EmptyState title="No settled picks yet" detail={emptyDetail} />;
  }

  const horizontal = layout === "bars";
  const height = horizontal ? Math.max(120, data.length * 34 + 16) : 190;

  return (
    <>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {horizontal ? (
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={124}
                tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
                tickFormatter={(v: string) => truncate(v, 20)}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(props) => <RateTooltip active={props.active} payload={props.payload} />} />
              <Bar isAnimationActive={false} dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                {data.map((d) => (
                  <Cell key={d.label} fill="var(--chart)" fillOpacity={d.settled >= SOLID_FROM ? 1 : 0.4} />
                ))}
                <LabelList dataKey="value" position="right" formatter={pctLabel} fill="var(--ink)" fontSize={11} />
              </Bar>
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="label" tick={{ fill: "var(--ink-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(props) => <RateTooltip active={props.active} payload={props.payload} />} />
              <Bar isAnimationActive={false} dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={30}>
                {data.map((d) => (
                  <Cell key={d.label} fill="var(--chart)" fillOpacity={d.settled >= SOLID_FROM ? 1 : 0.4} />
                ))}
                <LabelList dataKey="value" position="top" formatter={pctLabel} fill="var(--ink)" fontSize={11} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Faded bars have fewer than {SOLID_FROM} settled picks. Tap a bar for details.</p>
    </>
  );
}
