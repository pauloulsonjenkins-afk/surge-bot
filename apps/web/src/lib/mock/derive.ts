import {
  BotMeta,
  BOTS,
  DashboardSummary,
  LEAGUES,
  LeagueBreakdown,
  BotPerformance,
  OpenPosition,
  SeriesPoint,
  Timeframe,
  Trade,
} from "@/domain/dashboard";
import { BUCKET_COUNT } from "./generate";

function pctChange(current: number, previous: number): number | undefined {
  if (previous === 0) return current === 0 ? 0 : undefined; // undefined = "not a meaningful %"
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function deriveSummary(
  trades: Trade[],
  prevTrades: Trade[],
  openPositions: OpenPosition[]
): DashboardSummary {
  const totalPoints = trades.reduce((sum, t) => sum + t.points, 0);
  const prevPoints = prevTrades.reduce((sum, t) => sum + t.points, 0);

  const cumulativePnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const prevPnl = prevTrades.reduce((sum, t) => sum + t.pnl, 0);

  const wins = trades.filter((t) => t.outcome === "win").length;
  const losses = trades.filter((t) => t.outcome === "loss").length;
  const ratio = losses === 0 ? wins : wins / losses;

  const prevWins = prevTrades.filter((t) => t.outcome === "win").length;
  const prevLosses = prevTrades.filter((t) => t.outcome === "loss").length;
  const prevRatio = prevLosses === 0 ? prevWins : prevWins / prevLosses;

  const exposureValue = openPositions.reduce((sum, p) => sum + p.stake, 0);

  return {
    totalPoints: { value: totalPoints, changePct: pctChange(totalPoints, prevPoints) },
    cumulativePnl: { value: cumulativePnl, changePct: pctChange(cumulativePnl, prevPnl) },
    winLossRatio: { value: ratio, changePct: pctChange(ratio, prevRatio), wins, losses },
    activeExposure: { value: exposureValue, openPositions: openPositions.length },
  };
}

function bucketLabel(timeframe: Timeframe, t: number): string {
  const d = new Date(t);
  if (timeframe === "1D") {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, {
    weekday: timeframe === "7D" ? "short" : undefined,
    day: "numeric",
    month: "short",
  });
}

/** Buckets a set of trades into cumulative P&L / ROI points across the window they were generated for. */
export function deriveSeries(
  trades: Trade[],
  timeframe: Timeframe,
  windowStart: number,
  windowEnd: number
): SeriesPoint[] {
  const slots = BUCKET_COUNT[timeframe];
  const slotMs = (windowEnd - windowStart) / slots;

  let cumPnl = 0;
  let cumStake = 0;
  const points: SeriesPoint[] = [];

  for (let s = 0; s < slots; s++) {
    const slotStart = windowStart + s * slotMs;
    const slotEnd = slotStart + slotMs;
    const slotTrades = trades.filter((t) => t.settledAt >= slotStart && t.settledAt < slotEnd);
    for (const t of slotTrades) {
      cumPnl += t.pnl;
      cumStake += t.stake;
    }
    points.push({
      t: slotStart,
      label: bucketLabel(timeframe, slotStart),
      pnl: Math.round(cumPnl * 100) / 100,
      roi: cumStake === 0 ? 0 : Math.round((cumPnl / cumStake) * 1000) / 10,
    });
  }

  return points;
}

export function deriveLeagueBreakdown(trades: Trade[], prevTrades: Trade[] = []): LeagueBreakdown[] {
  return LEAGUES.map((league) => {
    const leagueTrades = trades.filter((t) => t.league === league);
    const wins = leagueTrades.filter((t) => t.outcome === "win").length;
    const decided = leagueTrades.filter((t) => t.outcome !== "void").length;
    const pnl = Math.round(leagueTrades.reduce((sum, t) => sum + t.pnl, 0) * 100) / 100;

    const prevPnl = prevTrades.filter((t) => t.league === league).reduce((sum, t) => sum + t.pnl, 0);

    return {
      league,
      pnl,
      trades: leagueTrades.length,
      winRate: decided === 0 ? 0 : wins / decided,
      changePct: pctChange(pnl, prevPnl),
    };
  });
}

export function deriveBotPerformance(
  trades: Trade[],
  timeframe: Timeframe,
  windowStart: number,
  windowEnd: number,
  bots: BotMeta[] = BOTS,
  prevTrades: Trade[] = []
): BotPerformance[] {
  return bots.map((bot) => {
    const botTrades = trades.filter((t) => t.botId === bot.id);
    const wins = botTrades.filter((t) => t.outcome === "win").length;
    const decided = botTrades.filter((t) => t.outcome !== "void").length;
    const totalPnl = Math.round(botTrades.reduce((sum, t) => sum + t.pnl, 0) * 100) / 100;
    const totalStake = botTrades.reduce((sum, t) => sum + t.stake, 0);

    const prevPnl = prevTrades.filter((t) => t.botId === bot.id).reduce((sum, t) => sum + t.pnl, 0);

    return {
      bot,
      series: deriveSeries(botTrades, timeframe, windowStart, windowEnd),
      totalPnl,
      roi: totalStake === 0 ? 0 : Math.round((totalPnl / totalStake) * 1000) / 10,
      winRate: decided === 0 ? 0 : wins / decided,
      trades: botTrades.length,
      changePct: pctChange(totalPnl, prevPnl),
    };
  });
}
