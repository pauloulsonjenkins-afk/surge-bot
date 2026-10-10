/** Plain-English names for the market codes the engine stores. One place, so every page agrees. */
export const MARKET_LABEL: Record<string, string> = {
  NEXT_GOAL: "Next goal",
  BOTH_TEAMS_TO_SCORE: "Both teams to score",
  FIRST_HALF_CORNERS: "1st half corners",
  UNDERDOG_DOUBLE_CHANCE: "Underdog win or draw",
  FAVOURITE_TO_WIN: "Favourite to win",
  FAVOURITE_TO_SCORE: "Favourite to score",
  OVER_1_5: "Over 1.5 goals",
  FIRST_HALF_GOALS: "1st half goals (pre-match)",
  AWAY_WIN_LAY: "Away win lay (pre-match)",
};

export function marketName(market: string | null): string | null {
  return market ? (MARKET_LABEL[market] ?? market) : null;
}

/** "Next goal · Over 1.5". Leaves the selection out when it only repeats the bet type ("Favourite to win · Favourite to win"). */
export function betText(market: string | null | undefined, selection: string | null | undefined): string | null {
  const label = marketName(market ?? null);
  if (!label) return null;
  if (!selection) return label;
  const squash = (t: string) => t.toLowerCase().replace(/\bto\b/g, "").replace(/[^a-z0-9]/g, "");
  return squash(selection) === squash(label) ? label : `${label} · ${selection}`;
}
