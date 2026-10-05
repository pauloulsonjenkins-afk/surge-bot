"use client";

import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbp } from "@/lib/format";
import { RANK_COLOUR, RANK_LABEL, RANKS, type Point, type Summary } from "@/lib/horses";

const axisTick = { fill: "var(--ink-muted)", fontSize: 10 };
const money = (v: number) => `${v < 0 ? "−" : ""}£${Math.abs(v)}`;
/** About six labels along the bottom however many points there are. */
const every = (n: number) => Math.max(0, Math.ceil(n / 6) - 1);

function Tip({ active, payload, rows }: { active?: boolean; payload?: ReadonlyArray<{ payload?: Point }>; rows: (p: Point) => Array<[string, string, string?]> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-ink">{p.label}</p>
      {rows(p).map(([k, v, colour]) => (
        <p key={k} className="flex items-center gap-1.5 text-xs tabular-nums text-ink">
          {colour && <span className="h-2 w-2 rounded-full" style={{ background: colour }} />}
          <span className="text-ink-muted">{k}</span> {v}
        </p>
      ))}
    </div>
  );
}

/** Running profit across the period: one line, so the card's title names it and there is no legend. */
export function RunningProfitChart({ points }: { points: Point[] }) {
  const last = points[points.length - 1];
  return (
    <div className="h-56 w-full" role="img" aria-label={`Running profit, ending at ${last ? gbp(last.total) : "£0"}`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 340, height: 224 }}>
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={every(points.length)} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={money} width={52} />
          <ReferenceLine y={0} stroke="var(--line)" />
          <Tooltip
            cursor={{ stroke: "var(--ink-muted)", strokeDasharray: "3 3" }}
            content={(p) => (
              <Tip
                active={p.active}
                payload={p.payload as ReadonlyArray<{ payload?: Point }>}
                rows={(x) => [
                  ["Running", gbp(x.total)],
                  ["This period", gbp(x.profit)],
                  ["Staked", `£${x.staked.toFixed(2)}`],
                ]}
              />
            )}
          />
          <Line type="linear" dataKey="total" stroke="var(--chart)" strokeWidth={2} dot={points.length <= 20 ? { r: 3, fill: "var(--chart)" } : false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Profit at each racecourse, best first: one bar each, green above zero, red below. */
export function CourseChart({ rows }: { rows: Array<{ label: string; summary: Summary }> }) {
  const data = rows.map((r) => ({ label: r.label, profit: r.summary.profit, s: r.summary }));
  const height = Math.max(120, data.length * 30 + 24);
  return (
    <div className="w-full" style={{ height }} role="img" aria-label={`Profit by racecourse: ${data.map((d) => `${d.label} ${gbp(d.profit)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 340, height }}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap="22%">
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={money} />
          <YAxis type="category" dataKey="label" tick={{ ...axisTick, fill: "var(--ink)" }} tickLine={false} axisLine={false} width={104} interval={0} />
          <ReferenceLine x={0} stroke="var(--line)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(p) => {
              const d = (p.payload as ReadonlyArray<{ payload?: (typeof data)[number] }> | undefined)?.[0]?.payload;
              if (!p.active || !d) return null;
              const roi = d.s.roi === null ? "–" : `${d.s.roi > 0 ? "+" : d.s.roi < 0 ? "−" : ""}${Math.abs(Math.round(d.s.roi * 1000) / 10)}%`;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-xl">
                  <p className="text-xs font-medium text-ink">{d.label}</p>
                  <p className="text-xs tabular-nums text-ink">
                    <span className="text-ink-muted">Profit</span> {gbp(d.profit)}
                  </p>
                  <p className="text-xs tabular-nums text-ink">
                    <span className="text-ink-muted">Per £1</span> {roi}
                  </p>
                  <p className="text-xs tabular-nums text-ink">
                    <span className="text-ink-muted">Bets</span> {d.s.bets} ({d.s.won} won)
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="profit" radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.profit >= 0 ? "var(--hit)" : "var(--loss)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Profit per day, week or month: green above zero, red below. */
export function PeriodProfitChart({ points }: { points: Point[] }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="Profit or loss for each period">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 340, height: 192 }}>
        <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barCategoryGap="18%">
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={every(points.length)} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={money} width={52} />
          <ReferenceLine y={0} stroke="var(--line)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(p) => (
              <Tip
                active={p.active}
                payload={p.payload as ReadonlyArray<{ payload?: Point }>}
                rows={(x) => [
                  ["Profit", gbp(x.profit)],
                  ["Staked", `£${x.staked.toFixed(2)}`],
                  ["Returned", `£${x.returns.toFixed(2)}`],
                  ["Bets", String(x.bets)],
                ]}
              />
            )}
          />
          <Bar dataKey="profit" radius={[4, 4, 4, 4]} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.key} fill={p.profit >= 0 ? "var(--hit)" : "var(--loss)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Running profit for each choice. Four lines, so it carries a legend and labels the end of each line with its total
 * (two of the colours are faint on the light theme, so colour is never the only way to tell them apart).
 */
export function ByChoiceChart({ points }: { points: Point[] }) {
  const last = points[points.length - 1];
  const keys = { 1: "r1", 2: "r2", 3: "r3", 4: "r4" } as const;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink">
        {RANKS.map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: RANK_COLOUR[r] }} />
            {RANK_LABEL[r]}
            {last && <span className="tabular-nums text-ink-muted">{gbp(last[keys[r]])}</span>}
          </li>
        ))}
      </ul>
      <div className="h-56 w-full" role="img" aria-label="Running profit for each choice">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 340, height: 224 }}>
          <LineChart data={points} margin={{ top: 8, right: 64, bottom: 0, left: -8 }}>
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={every(points.length)} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={money} width={52} />
            <ReferenceLine y={0} stroke="var(--line)" />
            <Tooltip
              cursor={{ stroke: "var(--ink-muted)", strokeDasharray: "3 3" }}
              content={(p) => (
                <Tip
                  active={p.active}
                  payload={p.payload as ReadonlyArray<{ payload?: Point }>}
                  rows={(x) => RANKS.map((r) => [RANK_LABEL[r], gbp(x[keys[r]]), RANK_COLOUR[r]] as [string, string, string])}
                />
              )}
            />
            {RANKS.map((r) => (
              <Line
                key={r}
                type="linear"
                dataKey={keys[r]}
                name={RANK_LABEL[r]}
                stroke={RANK_COLOUR[r]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                label={(props: { index?: number; x?: number | string; y?: number | string }) =>
                  props.index === points.length - 1 && props.x !== undefined && props.y !== undefined ? (
                    <text key={`end-${r}`} x={Number(props.x) + 6} y={Number(props.y)} dy={3} fontSize={10} fill="var(--ink)">
                      {RANK_LABEL[r]}
                    </text>
                  ) : (
                    <g key={`none-${r}-${props.index}`} />
                  )
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
