/**
 * CLASHES (added 24 Oct 2026): two bets on the same match that work against each other.
 *
 * Each bet is reduced to what it is exposed to:
 *   goals   Over or Under a total-goals line: Next goal, Over 1.5, two more goals (Over); No more goals and LAY next goal
 *           (Under). A LAY of Over x.5 is the same money as backing Under x.5.
 *   result  the full-time outcomes it wins on, of home / draw / away: Home to win {H}, LAY home win {D, A}, Away win lay
 *           {H, D}, Favourite to win {its side}, Underdog double chance {its side, D}.
 * Anything else (both teams to score, first-half bets, corners) isn't compared.
 *
 * Two bets on one match then:
 *   cancels    they can't both win: back Over 1.5 with LAY Over 1.5, or back the home side with LAY home win. The money
 *              mostly goes round in a circle, less the spread and commission. A new Live bet that cancels one already
 *              on is NOT placed (bet-feed.ts), and a LAY isn't made against one (lay-groups.ts).
 *   offsets    each also wins where the other loses, and they share some outcomes (Away win lay with LAY home win: both
 *              win on a draw). Allowed: together they are a narrower bet, not a wash.
 *   doubles    one wins whenever the other does: more money on the same thing. Allowed (the match limit still applies).
 *   unrelated  different things (goals against the result), or nothing to compare.
 */

type Outcome = "H" | "D" | "A";
export type Exposure = { kind: "goals"; line: number; over: boolean } | { kind: "result"; wins: Outcome[] } | null;
export type ClashKind = "cancels" | "offsets" | "doubles" | "unrelated";

interface BetLike {
  market: string | null;
  detail?: { targetLine?: number | null; favourite?: "home" | "away" | null; underdog?: "home" | "away" | null } | null;
}

/** What one bet is exposed to (see the top of this file), or null when it isn't compared. */
export function exposureOf(p: BetLike): Exposure {
  const line = p.detail?.targetLine ?? null;
  switch (p.market) {
    case "NEXT_GOAL":
    case "OVER_1_5":
    case "TWO_MORE_GOALS":
      return line !== null ? { kind: "goals", line, over: true } : null;
    case "NO_MORE_GOALS":
    case "NEXT_GOAL_LAY":
      return line !== null ? { kind: "goals", line, over: false } : null;
    case "HOME_TO_WIN":
      return { kind: "result", wins: ["H"] };
    case "HOME_WIN_LAY":
      return { kind: "result", wins: ["D", "A"] };
    case "AWAY_WIN_LAY":
      return { kind: "result", wins: ["H", "D"] };
    case "FAVOURITE_TO_WIN": {
      const f = p.detail?.favourite;
      return f ? { kind: "result", wins: [f === "home" ? "H" : "A"] } : null;
    }
    case "UNDERDOG_DOUBLE_CHANCE": {
      const u = p.detail?.underdog;
      return u ? { kind: "result", wins: [u === "home" ? "H" : "A", "D"] } : null;
    }
    default:
      return null;
  }
}

/** How two bets on the same match relate (see the top of this file). */
export function clashOf(a: Exposure, b: Exposure): ClashKind {
  if (!a || !b || a.kind !== b.kind) return "unrelated";
  if (a.kind === "goals" && b.kind === "goals") {
    if (a.over === b.over) return "doubles";
    // Opposite ways on the same line can't both win. On different lines they share a band of totals (both win, or both
    // lose), so they're a narrower bet rather than a wash.
    return a.line === b.line ? "cancels" : "offsets";
  }
  if (a.kind === "result" && b.kind === "result") {
    const shared = a.wins.filter((o) => b.wins.includes(o));
    if (shared.length === 0) return "cancels";
    if (shared.length === a.wins.length || shared.length === b.wins.length) return "doubles";
    return "offsets";
  }
  return "unrelated";
}
