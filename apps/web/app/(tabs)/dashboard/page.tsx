"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useHitRateStats } from "@/queries/use-stats";
import { usePerformanceCells } from "@/queries/use-performance";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { TIMEFRAMES, TimeframeToggle, type Timeframe } from "@/components/dashboard/TimeframeToggle";
import { DailyResultsChart } from "@/components/dashboard/DailyResultsChart";
import { HitRateTrendChart } from "@/components/dashboard/HitRateTrendChart";
import { RateBarChart } from "@/components/dashboard/RateBarChart";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { PerformanceSection } from "@/components/dashboard/PerformanceSection";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("7D");
  const days = TIMEFRAMES.find((t) => t.value === timeframe)?.days ?? null;
  const [strategy, setStrategy] = useState<string | null>(null);
  const { data, isLoading, error } = useHitRateStats(days, strategy);
  const performance = usePerformanceCells(days);
  const performanceCells = performance.data ?? [];

  // Leagues with nothing settled are left out of the chart; the busiest eight are shown.
  const leagues = (data?.byLeague ?? []).filter((l) => l.hits + l.misses > 0).slice(0, 8);
  const strategies = (data?.byStrategy ?? []).filter((s) => s.hits + s.misses > 0);

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight text-ink">Dashboard</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/more/admin/sending"
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink"
          >
            <Lock size={13} />
            Admin
          </Link>
        </div>
      </div>
      <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      {strategy && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-muted">Showing only</span>
          <span className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-ink">{strategy}</span>
          <button type="button" onClick={() => setStrategy(null)} className="ml-1 text-ink-muted underline">
            Show all strategies
          </button>
        </div>
      )}

      {error ? (
        <QueryError error={error} next="/dashboard" />
      ) : (
        <>
          <SummaryCards stats={data} isLoading={isLoading} />
          <DailyResultsChart stats={data} isLoading={isLoading} />
          <HitRateTrendChart stats={data} isLoading={isLoading} />

          {performanceCells.length > 0 ? (
            <PerformanceSection key={days ?? "all"} cells={performanceCells} strategy={strategy} onStrategyChange={setStrategy} />
          ) : (
            <>
              <ChartCard title="By strategy" subtitle="Hit rate from settled picks">
                {isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <RateBarChart rows={strategies} layout="bars" emptyDetail="Strategies appear once picks settle." />
                )}
              </ChartCard>

              <ChartCard title="By alert minute" subtitle="Hit rate by the match minute the alert fired">
                {isLoading ? (
                  <Skeleton className="h-44 w-full" />
                ) : (
                  <RateBarChart rows={data?.byMinute ?? []} layout="columns" emptyDetail="Minute breakdown appears once picks settle." />
                )}
              </ChartCard>

              <ChartCard title="By league" subtitle="Busiest leagues first">
                {isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <RateBarChart rows={leagues} layout="bars" emptyDetail="Leagues appear once picks settle." />
                )}
              </ChartCard>
            </>
          )}
        </>
      )}
    </div>
  );
}
