/**
 * The plain answer for each strategy (owner, 21-22 Nov 2026: "I need to know in simple terms if a strategy is making or
 * losing money ... how can something be in profit in sim but if you put to real it's a loser? surely this needs to be a
 * combined figure").
 *
 * Why combined: real and trial bets are two samples of the SAME rule on different alerts and days. At 100-150 real bets a
 * strategy's real result is mostly luck (its likely range is about +-15 points), so the two often point opposite ways with
 * nothing wrong. Added together they are 300-700 bets, which is what answers "is the idea any good?". So a strategy's
 * headline figure and label are its real and trial bets TOGETHER, with the split always shown underneath.
 *
 * What is never combined: the money that reached the Betfair account. The Real money total on this page, and Home's
 * "Is it paying?", are real bets only, because only those reconcile to the balance. A Golden slice betting real money
 * inside a strategy that is on trial is shown on its own real bets (it has no trial side).
 *
 * The label needs ENOUGH bets; under that it is "Too early", whatever the £ says.
 */
export const ENOUGH = 50;

export type Verdict = "making" | "losing" | "level" | "early" | "none";

/** Within this share of the money staked, either way, is "around break-even": a 1p swing can't flip the label. */
export const LEVEL_BAND = 0.01;

/** One side's bets: real or trial. */
interface Split {
  profit: number;
  bets: number;
}

export interface MoneyLine {
  /** Where the line links to, and its React key. */
  key: string;
  name: string;
  /** "Only: home team 1 down" for a Golden slice. */
  detail?: string;
  /** The headline figure: real and trial together (a Golden slice: its own real bets). */
  profit: number;
  bets: number;
  verdict: Verdict;
  lay?: boolean;
  /** The two sides of the headline, shown underneath. Null when that side has no bets. */
  real?: Split | null;
  trial?: Split | null;
  /** On trial only: the engine suggests trying it with real money. */
  ready?: boolean;
  /** Real and trial both have 20+ bets and point opposite ways. */
  disagree?: boolean;
  /**
   * The real bets are doing far worse than the trial ones, and there are enough to be suspicious (REAL_WORSE_BETS+ bets
   * losing half their stake or more while the trial is in profit). Luck explains a gap over 100 bets, not 7 straight
   * losses at a 58% win rate (about 1 in 400): the real fills differ from the trial's. Never hide it in a combined figure.
   */
  realWorse?: boolean;
}

/** Real bets, and the share of their stake lost, past which a trial in profit is not to be trusted. */
const REAL_WORSE_BETS = 5;
const REAL_WORSE_LOSS = 0.5;

export function verdictOf(profit: number, bets: number, staked?: number | null): Verdict {
  if (bets === 0) return "none";
  if (bets < ENOUGH) return "early";
  if (staked && staked > 0 && Math.abs(profit / staked) < LEVEL_BAND) return "level";
  return profit > 0 ? "making" : "losing";
}

/** Real money and trial point opposite ways (both clearly one side of zero). */
export function disagrees(trialProfit: number, realProfit: number): boolean {
  return (trialProfit > 0 && realProfit < 0) || (trialProfit < 0 && realProfit > 0);
}

/** Bets a side needs before "real and trial disagree" is said: fewer is just a small sample. */
const DISAGREE_FROM = 20;

export const VERDICT_WORDS: Record<Verdict, string> = {
  making: "Making money",
  losing: "Losing money",
  level: "Around break-even",
  early: "Too early to tell",
  none: "No bets yet",
};

type Side = { counted?: number; profit?: number; staked?: number } | null | undefined;

const side = (r: Side): Split | null => (r && (r.counted ?? 0) > 0 ? { profit: r.profit ?? 0, bets: r.counted ?? 0 } : null);

/**
 * A strategy's line: the headline is every bet, real and trial together, with the two sides underneath. `all` is the
 * engine's own combined figure; without it (an older engine) the two sides are added. Pure.
 */
export function strategyLine(base: Pick<MoneyLine, "key" | "name" | "lay" | "ready">, r: { live?: Side; sim?: Side; all?: Side }): MoneyLine {
  const real = side(r.live);
  const trial = side(r.sim);
  const haveAll = !!r.all && (r.all.counted ?? 0) > 0;
  const bets = haveAll ? (r.all?.counted ?? 0) : (real?.bets ?? 0) + (trial?.bets ?? 0);
  const profit = haveAll ? (r.all?.profit ?? 0) : (real?.profit ?? 0) + (trial?.profit ?? 0);
  const staked = haveAll ? r.all?.staked : (r.live?.staked ?? 0) + (r.sim?.staked ?? 0);
  return {
    ...base,
    profit,
    bets,
    verdict: verdictOf(profit, bets, staked),
    real,
    trial,
    disagree: !!real && !!trial && real.bets >= DISAGREE_FROM && trial.bets >= DISAGREE_FROM && disagrees(trial.profit, real.profit),
    realWorse: !!real && !!trial && trial.profit > 0 && real.bets >= REAL_WORSE_BETS && (r.live?.staked ?? 0) > 0 && real.profit / (r.live?.staked ?? 1) <= -REAL_WORSE_LOSS,
  };
}

/** A Golden slice betting real money on its own: its own real bets, no trial side. */
export function sliceLine(base: Pick<MoneyLine, "key" | "name" | "detail">, own: Side): MoneyLine {
  const real = side(own);
  const profit = real?.profit ?? 0;
  const bets = real?.bets ?? 0;
  return { ...base, profit, bets, verdict: verdictOf(profit, bets, own?.staked), real, trial: null };
}

/** £ with its sign: "+£5.24", "−£19.50", "£0.00". */
export function signedGbp(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}£${Math.abs(v).toFixed(2)}`;
}

/** Best first: by verdict (making, break-even, too early, none, losing), then by £. */
export function byMoney(a: MoneyLine, b: MoneyLine): number {
  const rank: Record<Verdict, number> = { making: 0, level: 1, early: 2, none: 3, losing: 4 };
  return rank[a.verdict] - rank[b.verdict] || b.profit - a.profit;
}

/** The REAL money of a list (never the combined headline): what reached the Betfair account. */
export function realTotalOf(lines: MoneyLine[]): Split {
  return lines.reduce((t, l) => ({ profit: t.profit + (l.real?.profit ?? 0), bets: t.bets + (l.real?.bets ?? 0) }), { profit: 0, bets: 0 });
}
