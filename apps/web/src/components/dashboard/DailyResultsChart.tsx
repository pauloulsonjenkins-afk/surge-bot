"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HitRateStats } from "@/queries/use-stats";
import { ChartCard } from "./ChartCard";
import { ChartTooltip, type ChartTooltipProps } from "./ChartTooltip";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

const HIT = "var(--hit)";
const MISS = "var(--loss)";

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function DailyResultsChart({ stats, isLoading }: { stats: HitRateStats | undefined; isLoading: boolean }) {
  const data = (stats?.daily ?? []).map((d) => ({ ...d, label: shortDate(d.date) }));

  return (
    <ChartCard title="Results by day" subtitle="Settled picks per UK day">
      {isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : data.length === 0 ? (
        <EmptyState title="No settled picks yet" detail="Results appear here once matches finish." />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="label" tick={{ fill: "var(--ink-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    label={props.label}
                    payload={props.payload as unknown as ChartTooltipProps["payload"]}
                    series={{
                      hits: { label: "Hits", color: "var(--hit)", format: (v) => String(v) },
                      misses: { label: "Misses", color: "var(--loss)", format: (v) => String(v) },
                    }}
                  />
                )}
              />
              <Bar isAnimationActive={false} dataKey="hits" stackId="r" fill={HIT} maxBarSize={28} />
              <Bar isAnimationActive={false} dataKey="misses" stackId="r" fill={MISS} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
