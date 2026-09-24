"use client";

import { useState } from "react";
import { Timeframe } from "@/domain/dashboard";
import {
  useBotPerformance,
  useDashboardSummary,
  useLeagueBreakdown,
  usePnlRoiSeries,
} from "@/queries/use-dashboard";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { TimeframeToggle } from "@/components/dashboard/TimeframeToggle";
import { PnlRoiChart } from "@/components/dashboard/PnlRoiChart";
import { LeagueBreakdownChart } from "@/components/dashboard/LeagueBreakdownChart";
import { BotPerformanceChart } from "@/components/dashboard/BotPerformanceChart";

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");

  const summary = useDashboardSummary(timeframe);
  const pnlRoi = usePnlRoiSeries(timeframe);
  const leagues = useLeagueBreakdown(timeframe);
  const bots = useBotPerformance(timeframe);

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium tracking-tight text-ink">Dashboard</h1>
        <TimeframeToggle value={timeframe} onChange={setTimeframe} />
      </div>

      <SummaryCards summary={summary.data} isLoading={summary.isLoading} />

      <PnlRoiChart series={pnlRoi.data} isLoading={pnlRoi.isLoading} />
      <LeagueBreakdownChart data={leagues.data} isLoading={leagues.isLoading} />
      <BotPerformanceChart data={bots.data} isLoading={bots.isLoading} />
    </div>
  );
}
