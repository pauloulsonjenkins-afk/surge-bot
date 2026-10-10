/** The Edge cards as the engine sends them (mirrors edge/edge.ts). */
export interface EdgeTrend {
  kind: string;
  text: string;
  hits: number;
  sample: number;
  rate: number;
  strength: number;
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
