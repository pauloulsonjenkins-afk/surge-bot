/**
 * The plain answer for each strategy (owner, 21 Nov 2026: "I need to know in simple terms if a strategy is making or losing
 * money ... this SIM/LIVE business is just so confusing"). Two lists that never mix:
 *
 *   Real money   strategies placing real bets, and Golden slices placing real bets inside a strategy that isn't: their real
 *                £ only. A strategy with few real bets shows those few, never its trial figures (the old page "borrowed"
 *                Sim figures under 20 Live bets, so a lay that had lost every real bet showed +59%).
 *   On trial     pretend bets only: what it would have made.
 *
 * One figure (£) and one label each. The label needs ENOUGH bets; under that it is "Too early", whatever the £ says.
 */
export const ENOUGH = 50;

export type Verdict = "making" | "losing" | "early" | "none";

export interface MoneyLine {
  /** Where the line links to, and its React key. */
  key: string;
  name: string;
  /** "Only: home team 1 down" for a Golden slice. */
  detail?: string;
  profit: number;
  bets: number;
  verdict: Verdict;
  lay?: boolean;
  /** On trial only: the engine suggests trying it with real money. */
  ready?: boolean;
  /** On trial only: what it did with real money before, when it had 20+ real bets. */
  earlierReal?: { profit: number; bets: number } | null;
}

export function verdictOf(profit: number, bets: number): Verdict {
  if (bets === 0) return "none";
  if (bets < ENOUGH) return "early";
  return profit > 0 ? "making" : "losing";
}

export const VERDICT_WORDS: Record<"real" | "trial", Record<Verdict, string>> = {
  real: { making: "Making money", losing: "Losing money", early: "Too early to tell", none: "No real bets yet" },
  trial: { making: "Would be making money", losing: "Would be losing money", early: "Too early to tell", none: "No bets yet" },
};

/** £ with its sign: "+£5.24", "−£19.50", "£0.00". */
export function signedGbp(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}£${Math.abs(v).toFixed(2)}`;
}

/** Best first: by verdict (making, too early, none, losing), then by £. */
export function byMoney(a: MoneyLine, b: MoneyLine): number {
  const rank: Record<Verdict, number> = { making: 0, early: 1, none: 2, losing: 3 };
  return rank[a.verdict] - rank[b.verdict] || b.profit - a.profit;
}

/** The total of a list, in £ and bets. */
export function totalOf(lines: MoneyLine[]): { profit: number; bets: number } {
  return lines.reduce((t, l) => ({ profit: t.profit + l.profit, bets: t.bets + l.bets }), { profit: 0, bets: 0 });
}
