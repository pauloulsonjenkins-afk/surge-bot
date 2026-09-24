import { Timeframe } from "@/domain/dashboard";

export const dashboardKeys = {
  summary: (tf: Timeframe) => ["dashboard", "summary", tf] as const,
  pnlRoi: (tf: Timeframe) => ["dashboard", "pnl-roi", tf] as const,
  leagueBreakdown: (tf: Timeframe) => ["dashboard", "league-breakdown", tf] as const,
  botPerformance: (tf: Timeframe) => ["dashboard", "bot-performance", tf] as const,
};
