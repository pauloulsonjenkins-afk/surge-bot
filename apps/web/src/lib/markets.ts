/** Plain-English names for the market codes the engine stores. One place, so every page agrees. */
export const MARKET_LABEL: Record<string, string> = {
  NEXT_GOAL: "Next goal",
  BOTH_TEAMS_TO_SCORE: "Both teams to score",
  FIRST_HALF_CORNERS: "1st half corners",
  UNDERDOG_DOUBLE_CHANCE: "Underdog win or draw",
  FAVOURITE_TO_WIN: "Favourite to win",
  FIRST_HALF_GOALS: "1st half goals (pre-match)",
};

export function marketName(market: string | null): string | null {
  return market ? (MARKET_LABEL[market] ?? market) : null;
}
