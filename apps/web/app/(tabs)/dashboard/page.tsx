"use client";

import { useState } from "react";
import { useHitRateStats } from "@/queries/use-stats";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { TIMEFRAMES, TimeframeToggle, type Timeframe } from "@/components/dashboard/TimeframeToggle";
import { DailyResultsChart } from "@/components/dashboard/DailyResultsChart";
import { RateList } from "@/components/dashboard/RateList";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { QueryError } from "@/components/ui/QueryError";

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("7D");
  const days = TIMEFRAMES.find((t) => t.value === timeframe)?.days ?? null;
  const { data, isLoading, error } = useHitRateStats(days);

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight text-ink">Dashboard</h1>
        <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      </div>

      {error ? (
        <QueryError error={error} next="/dashboard" />
      ) : (
        <>
          <SummaryCards stats={data} isLoading={isLoading} />
          <DailyResultsChart stats={data} isLoading={isLoading} />

          <ChartCard title="By strategy" subtitle="Hit rate from settled picks">
            {isLoading ? <Skeleton className="h-32 w-full" /> : <RateList rows={data?.byStrategy ?? []} emptyDetail="Strategies appear as picks arrive." />}
          </ChartCard>

          <ChartCard title="By league" subtitle="Most active first">
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <RateList rows={(data?.byLeague ?? []).slice(0, 10)} emptyDetail="Leagues appear as picks arrive." />
            )}
          </ChartCard>
        </>
      )}
    </div>
  );
}
