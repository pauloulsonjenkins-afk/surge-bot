"use client";

import type { PickMode } from "@/server/engine-client";
import { WinLossLines } from "@/components/admin/WinLossLines";
import { Skeleton } from "@/components/ui/Skeleton";
import { ChartCard } from "./ChartCard";
import { EmptyState } from "./EmptyState";
import { useDashboardWinLoss } from "./WinLossSummary";

/**
 * Admin, on the 1D view: today's profit building up pick by pick (in the order the alerts came in, UK time), in place
 * of a "results by day" chart that would only ever have one bar. Follows the Dashboard's strategy filter.
 */
export function TodayProfitChart({ mode, strategy }: { mode: PickMode; strategy: string | null }) {
  const winLoss = useDashboardWinLoss(mode);
  const key = strategy?.toLowerCase() ?? null;
  const data = (winLoss.data?.series.d1 ?? []).map((p) => ({ label: p.label, total: key === null ? p.total : (p.s[key] ?? 0) }));
  const last = data.at(-1)?.total ?? 0;
  const color = last > 0 ? "var(--hit)" : last < 0 ? "var(--loss)" : "var(--chart)";

  return (
    <ChartCard title="Today’s profit" subtitle="Running total as today’s picks settle, by the time each alert came in">
      {winLoss.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : data.length < 2 ? (
        <EmptyState title="Nothing settled today yet" detail="The line starts with today’s first settled pick." />
      ) : (
        <WinLossLines data={data} series={[{ key: "total", name: "Profit", color }]} />
      )}
    </ChartCard>
  );
}
