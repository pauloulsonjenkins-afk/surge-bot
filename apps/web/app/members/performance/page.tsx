"use client";

import { useState } from "react";
import { PageHeader, Card, Segmented, moneyTone } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { gbp } from "@/lib/format";
import { useMembersPerformance } from "@/queries/use-members";
import { ModeBanner, odds, pct, Tile } from "@/components/members/ui";

/** The member's own results, simulation and live never mixed. */
export default function PerformancePage() {
  const [mode, setMode] = useState<"sim" | "live">("sim");
  const [range, setRange] = useState<"all" | "30d" | "7d" | "today">("all");
  const { data, isLoading } = useMembersPerformance(mode, range);
  return (
    <div className="space-y-5">
      <PageHeader
        title="My performance"
        subtitle="Your own bets only. House strategy results are on Strategies."
        actions={
          <Segmented
            label="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "sim", label: "Simulation" },
              { value: "live", label: "Live" },
            ]}
          />
        }
      />
      <ModeBanner mode={mode} />
      <Segmented
        label="Period"
        value={range}
        onChange={setRange}
        options={[
          { value: "today", label: "Today" },
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "all", label: "All" },
        ]}
      />
      {isLoading || !data ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          {data.limitedToDays && <p className="text-xs text-ink-muted">Free membership shows the last {data.limitedToDays} days. Members see the full history.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.bank && <Tile label="Bank" value={gbp(data.bank.now, false)} sub={`started at ${gbp(data.bank.start, false)}`} />}
            <Tile label="Profit" value={gbp(data.summary.profit)} tone={moneyTone(data.summary.profit)} />
            <Tile label="ROI" value={pct(data.summary.roi, true)} sub={`on ${gbp(data.summary.staked, false)} staked`} />
            <Tile label="Hit rate" value={pct(data.summary.hitRate)} sub={`${data.summary.wins}W / ${data.summary.losses}L${data.summary.voids ? ` / ${data.summary.voids} void` : ""}`} />
            <Tile label="Bets" value={String(data.summary.bets)} sub={`${data.summary.open} open · ${data.summary.notPlaced} not placed`} />
            <Tile label="Average odds" value={odds(data.summary.avgOdds)} />
            <Tile label="Worst drawdown" value={gbp(-data.summary.maxDrawdown)} tone={data.summary.maxDrawdown > 0 ? "loss" : "muted"} />
            <Tile label="Streak" value={data.summary.currentStreak ?? "–"} sub={`best run ${data.summary.longestWinningRun}, worst ${data.summary.longestLosingRun}`} />
          </div>

          {data.curve.length > 1 && <Curve points={data.curve} label={mode === "sim" ? "Bank" : "Profit"} />}

          <Card title="By strategy">
            {data.byStrategy.length === 0 ? (
              <p className="text-sm text-ink-muted">No bets in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted">
                      <th className="py-1 font-medium">Strategy</th>
                      <th className="py-1 text-right font-medium">Bets</th>
                      <th className="py-1 text-right font-medium">W–L</th>
                      <th className="py-1 text-right font-medium">Hit</th>
                      <th className="py-1 text-right font-medium">Staked</th>
                      <th className="py-1 text-right font-medium">Profit</th>
                      <th className="py-1 text-right font-medium">ROI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byStrategy.map((s) => (
                      <tr key={s.strategyKey}>
                        <td className="py-1.5 text-ink">{s.strategyName}</td>
                        <td className="py-1.5 text-right tabular-nums">{s.bets}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {s.wins}–{s.losses}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{pct(s.hitRate)}</td>
                        <td className="py-1.5 text-right tabular-nums">{gbp(s.staked, false)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${s.profit > 0 ? "text-hit" : s.profit < 0 ? "text-loss" : ""}`}>{gbp(s.profit)}</td>
                        <td className="py-1.5 text-right tabular-nums">{pct(s.roi, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="text-xs text-ink-muted">
            Staking: {data.staking.method}. ROI = profit ÷ staked. Hit rate = won ÷ (won + lost); voids and bets not placed don&apos;t count.
            {data.assumptions ? ` ${data.assumptions}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

/** A simple line of the bank (or profit) by day. */
function Curve({ points, label }: { points: Array<{ date: string; value: number }>; label: string }) {
  const w = 600;
  const h = 140;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (points.length - 1)) * w},${h - ((p.value - min) / span) * (h - 10) - 5}`).join(" ");
  const up = points[points.length - 1]!.value >= points[0]!.value;
  return (
    <Card title={`${label} over time`} subtitle={`${points[0]!.date} to ${points[points.length - 1]!.date}`}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`${label} from ${gbp(points[0]!.value, false)} to ${gbp(points[points.length - 1]!.value, false)}`} preserveAspectRatio="none">
        <path d={d} fill="none" stroke={up ? "var(--hit)" : "var(--loss)"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </Card>
  );
}
