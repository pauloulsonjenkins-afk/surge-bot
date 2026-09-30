"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HitRateStats } from "@/queries/use-stats";
import { ChartCard } from "./ChartCard";
import { ChartTooltip, type ChartTooltipProps } from "./ChartTooltip";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Running hit rate: at each day, every settled pick up to and including that day. */
export function HitRateTrendChart({ stats, isLoading }: { stats: HitRateStats | undefined; isLoading: boolean }) {
  let hits = 0;
  let misses = 0;
  const data = (stats?.daily ?? []).map((d) => {
    hits += d.hits;
    misses += d.misses;
    return { label: shortDate(d.date), rate: Math.round((hits / (hits + misses)) * 1000) / 10, settled: hits + misses };
  });

  return (
    <ChartCard title="Hit rate over time" subtitle="Running hit rate, all settled picks to date">
      {isLoading ? (
        <Skeleton className="h-52 w-full" />
      ) : data.length < 2 ? (
        <EmptyState title="Needs two days of results" detail="The trend line appears once results span more than one day." />
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <XAxis dataKey="label" tick={{ fill: "var(--ink-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: "var(--line)" }}
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    label={props.label}
                    payload={props.payload as unknown as ChartTooltipProps["payload"]}
                    series={{
                      rate: { label: "Hit rate", color: "var(--chart)", format: (v) => `${v}%` },
                      settled: { label: "Settled", color: "var(--ink-muted)", format: (v) => String(v) },
                    }}
                  />
                )}
              />
              <Line isAnimationActive={false} type="monotone" dataKey="rate" stroke="var(--chart)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart)" }} />
              <Line isAnimationActive={false} dataKey="settled" stroke="transparent" dot={false} activeDot={false} legendType="none" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
