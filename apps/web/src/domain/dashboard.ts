export type Timeframe = "1D" | "7D" | "1M";

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1D", label: "Past Day" },
  { value: "7D", label: "7 Days" },
  { value: "1M", label: "Past Month" },
];

export const LEAGUES = [
  "Premier League",
  "Bundesliga",
  "Serie A",
  "La Liga",
  "Ligue 1",
] as const;

export type League = (typeof LEAGUES)[number];

export type TradeOutcome = "win" | "loss" | "void";

export interface Trade {
  id: string;
  fixture: string;
  league: League;
  botId: string;
  settledAt: number; // epoch ms
  stake: number;
  pnl: number;
  points: number;
  outcome: TradeOutcome;
}

/** A bet the engine currently has open — feeds Active Exposure, independent of timeframe. */
export interface OpenPosition {
  id: string;
  fixture: string;
  league: League;
  botId: string;
  stake: number;
  openedAt: number;
}

export type BotStatus = "active" | "paused";

export interface BotMeta {
  id: string;
  name: string;
  status: BotStatus;
  /** Short description of the trigger, shown in tooltips/legends. */
  strategy: string;
}

export const BOTS: BotMeta[] = [
  { id: "xg-velocity", name: "xG Velocity", status: "active", strategy: "Rising xG rate in-play" },
  { id: "pressure-index", name: "Pressure Index", status: "active", strategy: "Sustained territorial pressure" },
  { id: "late-surge", name: "Late Surge", status: "active", strategy: "Second-half goal anticipation" },
  { id: "break-even-hedge", name: "Break-even Hedge", status: "paused", strategy: "Lay-off once a target price is hit" },
];

export interface SummaryMetric {
  value: number;
  /** % change vs the prior equivalent window; omitted where a comparison isn't meaningful. */
  changePct?: number;
}

export interface DashboardSummary {
  totalPoints: SummaryMetric;
  cumulativePnl: SummaryMetric;
  winLossRatio: SummaryMetric & { wins: number; losses: number };
  activeExposure: { value: number; openPositions: number };
}

export interface SeriesPoint {
  t: number; // epoch ms, bucket start
  label: string;
  pnl: number; // cumulative
  roi: number; // cumulative, %
}

export interface LeagueBreakdown {
  league: League;
  pnl: number;
  trades: number;
  winRate: number; // 0-1
  changePct?: number;
}

export interface BotPerformance {
  bot: BotMeta;
  series: SeriesPoint[];
  totalPnl: number;
  roi: number;
  winRate: number;
  trades: number;
  changePct?: number;
}
