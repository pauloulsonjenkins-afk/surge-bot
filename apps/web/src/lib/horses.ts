/**
 * The sums behind the Horses page: what each bet cost and returned, filtered to a period, and broken down by choice,
 * odds band and weekday. Pure functions over the stored bets, so every figure on the page comes from one place.
 *
 * Money (the stake is per part, so "£5 each-way" costs £10):
 *   win bet       won: stake x odds back; lost: nothing back; void: stake back
 *   each-way bet  win part as above, plus a place part at place odds = 1 + (odds - 1) / fraction.
 *                 won: both parts pay; placed: only the place part pays; lost: nothing back; void: both stakes back
 *   EW Yankee     on a day's four selections: 11 bets (6 doubles, 4 trebles, a fourfold), each win and place, so 22 bets
 *                 at the unit stake. Win part of a bet pays the odds multiplied together when every horse in it won;
 *                 place part pays the place odds multiplied when every horse won or placed. A non-runner (void) counts
 *                 as odds of 1, so the rest of that bet stands. It settles once all four selections are marked.
 * A pending bet counts towards what was spent, but not towards returns, profit or strike rate until it is marked.
 */
import type { HorseBet, HorseDay } from "@/server/engine-client";

export const RANKS = [1, 2, 3, 4] as const;
export const RANK_LABEL: Record<HorseBet["rank"], string> = { 1: "NAP", 2: "Next best", 3: "3rd choice", 4: "4th choice" };
/** Chart colours by choice, always in this order (tokens in globals.css). */
export const RANK_COLOUR: Record<HorseBet["rank"], string> = { 1: "var(--series-1)", 2: "var(--series-2)", 3: "var(--series-3)", 4: "var(--series-4)" };

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** The price the place part of an each-way bet pays at. */
export function placeOdds(odds: number, fraction: number): number {
  return 1 + (odds - 1) / fraction;
}

export interface BetMoney {
  /** What the bet cost: the stake, or twice it for each-way. */
  cost: number;
  /** What came back, once settled (null while pending). */
  returned: number | null;
  /** returned - cost, once settled. */
  profit: number | null;
}

export function moneyOf(b: HorseBet): BetMoney {
  const ew = b.betType === "ew";
  const cost = ew ? b.stake * 2 : b.stake;
  if (b.result === "pending") return { cost, returned: null, profit: null };
  let returned = 0;
  if (b.result === "void") returned = cost;
  else if (b.result === "won") returned = b.stake * b.odds + (ew ? b.stake * placeOdds(b.odds, b.ewFraction ?? 4) : 0);
  else if (b.result === "placed" && ew) returned = b.stake * placeOdds(b.odds, b.ewFraction ?? 4);
  return { cost, returned: r2(returned), profit: r2(returned - cost) };
}

// ---------------------------------------------------------------------------
// EW Yankee

/** The 11 Yankee bets as sets of selection positions: 6 doubles, 4 trebles and the fourfold. */
const YANKEE_BETS: number[][] = (() => {
  const out: number[][] = [];
  for (let mask = 0; mask < 16; mask++) {
    const set = [0, 1, 2, 3].filter((i) => mask & (1 << i));
    if (set.length >= 2) out.push(set);
  }
  return out;
})();
export const YANKEE_BET_COUNT = YANKEE_BETS.length * 2;

export interface YankeeMoney extends BetMoney {
  day: string;
  unit: number;
  /** What each part paid back, once settled. */
  winPart: number | null;
  placePart: number | null;
}

/** An EW Yankee on a day's four selections. Null when the day doesn't have all four (it can't be a Yankee). */
export function yankeeMoney(day: string, unit: number, selections: HorseBet[]): YankeeMoney | null {
  const four = [...selections].filter((b) => b.day === day).sort((a, b) => a.rank - b.rank);
  if (four.length !== 4) return null;
  const cost = r2(unit * YANKEE_BET_COUNT);
  if (four.some((b) => b.result === "pending")) return { day, unit, cost, returned: null, profit: null, winPart: null, placePart: null };
  const win = four.map((b) => (b.result === "won" ? b.odds : b.result === "void" ? 1 : 0));
  const place = four.map((b) => (b.result === "won" || b.result === "placed" ? placeOdds(b.odds, b.ewFraction ?? 4) : b.result === "void" ? 1 : 0));
  const pays = (prices: number[]) => YANKEE_BETS.reduce((n, set) => n + unit * set.reduce((p, i) => p * prices[i]!, 1), 0);
  const winPart = r2(pays(win));
  const placePart = r2(pays(place));
  const returned = r2(winPart + placePart);
  return { day, unit, cost, returned, profit: r2(returned - cost), winPart, placePart };
}

/** Every day's Yankee, worked out from its selections. */
export function yankees(days: HorseDay[], bets: HorseBet[]): YankeeMoney[] {
  return days.flatMap((d) => (d.yankeeStake === null ? [] : [yankeeMoney(d.day, d.yankeeStake, bets)].filter((y): y is YankeeMoney => y !== null)));
}

// ---------------------------------------------------------------------------
// Periods

export type Preset = "today" | "week" | "month" | "year" | "all" | "custom";

const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
export const todayUk = (now = new Date()) => ukDay.format(now);

/** "2026-10-01" moved by n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week a day is in (UK racing weeks run Monday to Sunday). */
export function weekStart(day: string): string {
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

/** Whether a day falls in the chosen period. Custom = any of the ticked months (YYYY-MM), combined. */
export function inPeriod(day: string, preset: Preset, months: Set<string>, today: string): boolean {
  switch (preset) {
    case "today":
      return day === today;
    case "week":
      return day >= weekStart(today) && day <= today;
    case "month":
      return day.slice(0, 7) === today.slice(0, 7);
    case "year":
      return day.slice(0, 4) === today.slice(0, 4);
    case "custom":
      return months.has(day.slice(0, 7));
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Summaries

export interface Summary {
  /** Singles, plus any Yankees. */
  bets: number;
  yankees: number;
  /** Marked won, placed, lost or void. */
  settled: number;
  won: number;
  placed: number;
  lost: number;
  void: number;
  pending: number;
  /** Everything spent, pending bets included. */
  staked: number;
  /** Spent on settled bets: what profit and return per £1 are measured against. */
  settledStaked: number;
  returns: number;
  profit: number;
  /** Profit per £1 staked on settled bets. */
  roi: number | null;
  /** Winners (and each-way places) out of bets that ran, as a share 0-1. */
  strike: number | null;
  /** Placed or better, for each-way bets: share 0-1 (null with none). */
  placeRate: number | null;
  /** Mean decimal odds of winners. */
  avgWinOdds: number | null;
  avgOdds: number | null;
}

/** Totals for some singles and (optionally) Yankees. Yankees add to the money and bet counts, not to won/placed/lost. */
export function summarise(bets: HorseBet[], yk: YankeeMoney[] = []): Summary {
  const s: Summary = {
    bets: bets.length + yk.length, yankees: yk.length, settled: 0, won: 0, placed: 0, lost: 0, void: 0, pending: 0,
    staked: 0, settledStaked: 0, returns: 0, profit: 0, roi: null, strike: null, placeRate: null, avgWinOdds: null, avgOdds: null,
  };
  let winOddsSum = 0;
  let oddsSum = 0;
  let ewRan = 0;
  let ewPlacedOrWon = 0;
  for (const b of bets) {
    const m = moneyOf(b);
    s.staked += m.cost;
    oddsSum += b.odds;
    s[b.result]++;
    if (b.result === "pending") continue;
    s.settled++;
    s.settledStaked += m.cost;
    s.returns += m.returned ?? 0;
    s.profit += m.profit ?? 0;
    if (b.result === "won") winOddsSum += b.odds;
    if (b.betType === "ew" && b.result !== "void") {
      ewRan++;
      if (b.result === "won" || b.result === "placed") ewPlacedOrWon++;
    }
  }
  for (const y of yk) {
    s.staked += y.cost;
    if (y.profit === null) continue;
    s.settled++;
    s.settledStaked += y.cost;
    s.returns += y.returned ?? 0;
    s.profit += y.profit;
  }
  const ran = s.won + s.placed + s.lost;
  s.staked = r2(s.staked);
  s.settledStaked = r2(s.settledStaked);
  s.returns = r2(s.returns);
  s.profit = r2(s.profit);
  s.roi = s.settledStaked > 0 ? s.profit / s.settledStaked : null;
  s.strike = ran > 0 ? s.won / ran : null;
  s.placeRate = ewRan > 0 ? ewPlacedOrWon / ewRan : null;
  s.avgWinOdds = s.won > 0 ? winOddsSum / s.won : null;
  s.avgOdds = bets.length > 0 ? oddsSum / bets.length : null;
  if (bets.length === 0 && yk.length > 0) {
    s.strike = null;
    s.placeRate = null;
  }
  return s;
}

/** Longest run of settled losers in a row (in date and choice order), and when it ended. */
export function longestLosingRun(bets: HorseBet[]): { length: number; endedOn: string | null } {
  let run = 0;
  let best = { length: 0, endedOn: null as string | null };
  for (const b of [...bets].sort((a, c) => a.day.localeCompare(c.day) || a.rank - c.rank)) {
    if (b.result === "pending" || b.result === "void") continue;
    if (b.result === "lost") {
      run++;
      if (run > best.length) best = { length: run, endedOn: b.day };
    } else run = 0;
  }
  return best;
}

/** Odds bands in racing terms (decimal edges 2, 4, 8, 16 are evens, 3/1, 7/1 and 15/1). */
export const ODDS_BANDS: Array<{ label: string; max: number }> = [
  { label: "Evens or shorter", max: 2 },
  { label: "Up to 3/1", max: 4 },
  { label: "3/1 to 7/1", max: 8 },
  { label: "7/1 to 15/1", max: 16 },
  { label: "Over 15/1", max: Infinity },
];

export function byOddsBand(bets: HorseBet[]): Array<{ label: string; summary: Summary }> {
  return ODDS_BANDS.map((band, i) => ({
    label: band.label,
    summary: summarise(bets.filter((b) => b.odds <= band.max && (i === 0 || b.odds > ODDS_BANDS[i - 1]!.max))),
  })).filter((x) => x.summary.bets > 0);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function byWeekday(bets: HorseBet[]): Array<{ label: string; summary: Summary }> {
  return WEEKDAYS.map((label, i) => ({
    label,
    summary: summarise(bets.filter((b) => (new Date(`${b.day}T12:00:00Z`).getUTCDay() + 6) % 7 === i)),
  })).filter((x) => x.summary.bets > 0);
}

export function byRank(bets: HorseBet[]): Array<{ rank: HorseBet["rank"]; summary: Summary }> {
  return RANKS.map((rank) => ({ rank, summary: summarise(bets.filter((b) => b.rank === rank)) }));
}

export function byType(bets: HorseBet[], yk: YankeeMoney[] = []): Array<{ label: string; summary: Summary }> {
  return [
    { label: "Win singles", summary: summarise(bets.filter((b) => b.betType === "win")) },
    { label: "Each-way singles", summary: summarise(bets.filter((b) => b.betType === "ew")) },
    { label: "EW Yankee", summary: summarise([], yk) },
  ].filter((x) => x.summary.bets > 0);
}

// ---------------------------------------------------------------------------
// Chart series

export type Grain = "day" | "week" | "month";

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "2-digit" });

function bucketOf(day: string, grain: Grain): string {
  return grain === "day" ? day : grain === "week" ? weekStart(day) : `${day.slice(0, 7)}-01`;
}

export function bucketLabel(key: string, grain: Grain): string {
  const d = new Date(`${key}T12:00:00Z`);
  return grain === "month" ? monthFmt.format(d) : grain === "week" ? `w/c ${dayFmt.format(d)}` : dayFmt.format(d);
}

export interface Point {
  key: string;
  label: string;
  staked: number;
  returns: number;
  profit: number;
  /** Running profit to the end of this bucket, overall (Yankees included) and per choice (singles only), and the Yankees'. */
  total: number;
  yk: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  bets: number;
}

/**
 * One point per day, week or month that has settled bets, in order, with the period's money and the running profit
 * (overall and per choice). Pending bets (and Yankees still waiting on a result) are left out until they are marked.
 */
export function series(bets: HorseBet[], grain: Grain, yk: YankeeMoney[] = []): Point[] {
  const buckets = new Map<string, { bets: HorseBet[]; yk: YankeeMoney[] }>();
  const bucket = (day: string) => {
    const k = bucketOf(day, grain);
    return buckets.get(k) ?? buckets.set(k, { bets: [], yk: [] }).get(k)!;
  };
  for (const b of bets) if (b.result !== "pending") bucket(b.day).bets.push(b);
  for (const y of yk) if (y.profit !== null) bucket(y.day).yk.push(y);
  const running = { total: 0, yk: 0, 1: 0, 2: 0, 3: 0, 4: 0 } as Record<"total" | "yk" | 1 | 2 | 3 | 4, number>;
  return [...buckets.keys()].sort().map((key) => {
    const { bets: list, yk: ylist } = buckets.get(key)!;
    let staked = 0;
    let returns = 0;
    for (const b of list) {
      const m = moneyOf(b);
      staked += m.cost;
      returns += m.returned ?? 0;
      running[b.rank] += m.profit ?? 0;
      running.total += m.profit ?? 0;
    }
    for (const y of ylist) {
      staked += y.cost;
      returns += y.returned ?? 0;
      running.yk += y.profit ?? 0;
      running.total += y.profit ?? 0;
    }
    return {
      key,
      label: bucketLabel(key, grain),
      staked: r2(staked),
      returns: r2(returns),
      profit: r2(returns - staked),
      total: r2(running.total),
      yk: r2(running.yk),
      r1: r2(running[1]),
      r2: r2(running[2]),
      r3: r2(running[3]),
      r4: r2(running[4]),
      bets: list.length + ylist.length,
    };
  });
}

/** The series with a £0 starting point in front, so running-profit lines start from nothing (and one day still draws a line). */
export function fromZero(points: Point[]): Point[] {
  if (points.length === 0) return points;
  return [{ key: "start", label: "Start", staked: 0, returns: 0, profit: 0, total: 0, yk: 0, r1: 0, r2: 0, r3: 0, r4: 0, bets: 0 }, ...points];
}

/** The months that have bets, newest first, for the custom period picker. */
export function monthsWithBets(bets: HorseBet[]): string[] {
  return [...new Set(bets.map((b) => b.day.slice(0, 7)))].sort().reverse();
}
