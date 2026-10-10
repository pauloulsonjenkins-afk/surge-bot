/** The Edge cards as the engine sends them (mirrors edge/edge.ts). */
export interface EdgeTrend {
  kind: string;
  text: string;
  hits: number;
  sample: number;
  rate: number;
  strength: number;
  /** The Betfair bet the trend points at, if any. */
  bet?: { market: string; pick: string };
  /**
   * Betfair's back price for that bet (read in the 24 hours before kick-off): `needed` = the hit rate it needs after 2%
   * commission, `edge` = the trend's cautious hit rate minus that. Positive = potential value.
   */
  betfair?: { price: number | null; needed: number | null; edge: number | null; at: string; note?: string };
}

export interface EdgeCard {
  fixture: { div: string; league: string; country: string; kickoff: string; home: string; away: string };
  headline: EdgeTrend | null;
  trends: EdgeTrend[];
  homeGames: number;
  awayGames: number;
  computedAt: string;
}

export interface EdgeView {
  locked: boolean;
  /** Locked only: how many fixtures have a card. */
  count?: number;
  cards: EdgeCard[];
}
