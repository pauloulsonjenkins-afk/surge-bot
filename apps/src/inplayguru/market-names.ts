/** A market's name in words, for notifications. */
const MARKET_LABEL: Record<string, string> = {
  NEXT_GOAL: "Next goal",
  BOTH_TEAMS_TO_SCORE: "Both teams to score",
  FIRST_HALF_CORNERS: "1st half corners",
  UNDERDOG_DOUBLE_CHANCE: "Underdog win or draw",
  FAVOURITE_TO_WIN: "Favourite to win",
  HOME_TO_WIN: "Home to win",
  FAVOURITE_TO_SCORE: "Favourite to score",
  OVER_1_5: "Over 1.5 goals",
  OVER_2_5: "Over 2.5 goals",
  TWO_MORE_GOALS: "Two more goals",
  NO_MORE_GOALS: "No more goals",
  NEXT_GOAL_LAY: "LAY next goal",
  HOME_WIN_LAY: "LAY home win",
  FIRST_HALF_GOALS: "1st half goals (pre-match)",
  FIRST_HALF_GOAL_LIVE: "1st half goal (in-play)",
};

export function marketName(market: string | null): string | null {
  return market ? (MARKET_LABEL[market] ?? market) : null;
}
