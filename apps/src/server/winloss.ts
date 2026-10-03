/**
 * Win/Loss: an estimate of profit and loss in pounds.
 *
 * For every settled pick:
 *   stake  = the stake it was actually sent with, otherwise the stake set for its strategy
 *   odds   = the price printed in the alert (the "Over" price on the alert's
 *            Over/Under line, for Next Goal bets), otherwise the odds you told
 *            the app to assume for that strategy
 *   profit = hit:  stake x (odds - 1), less commission on the winnings
 *            miss: minus the stake
 * A pick with no stake or no usable odds is left out and counted, never guessed.
 *
 * Strategies merged on the Strategies page are shown as one line (the figures and the graph lines
 * add up their picks). The money is still worked out pick by pick with each original strategy's own
 * stake and assumed odds, so merging changes only how the results are grouped, never the pounds.
 *
 * This is an estimate from the alert's price, not from the bets your betting
 * software actually matched, so it will differ a little from the real account.
 *
 * Live and simulation (see PickMode in engine-db.ts): with mode "live" only picks that were actually
 * handed to the bet feed are priced, at the stake they were sent with; with "sim" only the ones that were
 * not, at the strategy's stake today. "all" prices both, as before. The per-strategy settings list
 * (stakes, assumed odds) always covers every strategy, whatever the mode, so none can be hidden from editing.
 *
 * Expenditure is a fixed monthly cost. It is OFF unless it has been ticked, and
 * it applies to the Month and Year figures only, charged on the 1st of each
 * month from the start month onwards.
 */
import { inPickMode, isLivePlacement, type EngineDb, type PickMode, type Placement } from "../storage/engine-db";
import { getSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { breakevenHitRate, hitRateRange, oddsFor, priceResult } from "./pricing";

export interface WinLossSettings {
  /** Betfair commission on winnings, in percent. */
  commission: number;
  /** Odds to use for a strategy whose alerts carry none, keyed by lower-case strategy name. */
  assumedOdds: Record<string, number>;
  expenditure: {
    /** OFF by default. Only ever becomes true when explicitly ticked. */
    enabled: boolean;
    /** Pounds per month. */
    monthly: number;
    /** First month charged, "YYYY-MM". */
    startMonth: string | null;
  };
}

export const DEFAULT_WINLOSS: WinLossSettings = {
  commission: 0,
  assumedOdds: {},
  expenditure: { enabled: false, monthly: 90, startMonth: null },
};

const KEY = "winloss";
const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const ukTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
}

function validMonth(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

export function getWinLossSettings(db: EngineDb): WinLossSettings {
  let raw: Partial<WinLossSettings> = {};
  try {
    const saved = db.getSetting(KEY);
    if (saved) raw = JSON.parse(saved) as Partial<WinLossSettings>;
  } catch {
    raw = {};
  }
  const assumedOdds: Record<string, number> = {};
  if (raw.assumedOdds && typeof raw.assumedOdds === "object") {
    for (const [k, v] of Object.entries(raw.assumedOdds)) {
      const o = num(v, 1.01, 1000);
      if (o !== null) assumedOdds[k.toLowerCase()] = o;
    }
  }
  const e = raw.expenditure ?? DEFAULT_WINLOSS.expenditure;
  return {
    commission: num(raw.commission, 0, 20) ?? 0,
    assumedOdds,
    expenditure: {
      enabled: e.enabled === true, // anything other than an explicit true is OFF
      monthly: num(e.monthly, 0, 100000) ?? DEFAULT_WINLOSS.expenditure.monthly,
      startMonth: validMonth(e.startMonth),
    },
  };
}

export function saveWinLossSettings(db: EngineDb, patch: Record<string, unknown>, now = new Date()): WinLossSettings {
  const cur = getWinLossSettings(db);
  const next: WinLossSettings = {
    ...cur,
    assumedOdds: { ...cur.assumedOdds },
    expenditure: { ...cur.expenditure },
  };

  if (patch.commission !== undefined) next.commission = num(patch.commission, 0, 20) ?? cur.commission;

  if (patch.assumedOdds && typeof patch.assumedOdds === "object") {
    for (const [k, v] of Object.entries(patch.assumedOdds as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (v === null) delete next.assumedOdds[key];
      else {
        const o = num(v, 1.01, 1000);
        if (o !== null) next.assumedOdds[key] = o;
      }
    }
  }

  const ex = patch.expenditure as Record<string, unknown> | undefined;
  if (ex && typeof ex === "object") {
    if (typeof ex.enabled === "boolean") next.expenditure.enabled = ex.enabled;
    if (ex.monthly !== undefined) next.expenditure.monthly = num(ex.monthly, 0, 100000) ?? cur.expenditure.monthly;
    if (ex.startMonth !== undefined) next.expenditure.startMonth = validMonth(ex.startMonth) ?? cur.expenditure.startMonth;
    // First time it is ticked, start charging from this month unless a start month was given.
    if (next.expenditure.enabled && next.expenditure.startMonth === null) {
      next.expenditure.startMonth = ukDay.format(now).slice(0, 7);
    }
  }

  db.setSetting(KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------

export interface WinLossPoint {
  /** Date (YYYY-MM-DD) or, for the one-day view, a time of day. */
  label: string;
  /** Cumulative profit, before expenditure. */
  total: number;
  /** Cumulative profit after expenditure. Same as total when expenditure is off. */
  totalAfter: number;
  /** Cumulative profit per strategy (keyed by lower-case strategy name). */
  s: Record<string, number>;
}

export interface WinLossPeriod {
  strategies: Record<string, number>;
  total: number;
  expenditure: number;
  totalAfter: number;
  picks: number;
}

export interface WinLossStrategy {
  label: string;
  key: string;
  market: string | null;
  stake: number | null;
  assumedOdds: number | null;
  /** Settled picks this year, and how they were handled. */
  settled: number;
  counted: number;
  noStake: number;
  noOdds: number;
  /** Simulation picks the bet feed's rules would have held back (minimum odds, stop loss, daily limit...). Not priced. */
  notPlaced: number;
  usedAlertOdds: number;
}

/** One line on the Profit and loss table and the strategy graph: a strategy, or several merged into one. */
export interface WinLossReported {
  /** Lower-case name; the key used in `periods[..].strategies` and `series[..].s`. */
  key: string;
  label: string;
  /** The original strategies (lower-case names) whose picks are added into this line. */
  members: string[];
}

export interface WinLossState {
  /** Which picks the figures, lines and graphs cover. */
  mode: PickMode;
  today: string;
  settings: WinLossSettings;
  maxStake: number;
  /** Each original strategy, with its stake and assumed odds. These are settings, so merged strategies stay separate here. */
  strategies: WinLossStrategy[];
  /** The lines the figures and graph show: merged strategies appear once. */
  reported: WinLossReported[];
  periods: { d1: WinLossPeriod; d7: WinLossPeriod; mtd: WinLossPeriod; ytd: WinLossPeriod };
  /** Month to date, one entry per UK day from the 1st to today (days with no settled picks are £0). Before any monthly cost. */
  mtdDaily: Array<{ date: string; pnl: number }>;
  series: { d1: WinLossPoint[]; d7: WinLossPoint[]; mtd: WinLossPoint[]; ytd: WinLossPoint[] };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeWinLoss(db: EngineDb, now = new Date(), mode: PickMode = "all"): WinLossState {
  const settings = getWinLossSettings(db);
  const sending = getSendingSettings(db);
  const today = ukDay.format(now);
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const start = { d1: today, d7: addDays(today, -6), mtd: `${month}-01`, ytd: `${year}-01-01` };

  // A day of margin either side of the year start; the exact UK day is checked below.
  const rows = db.listResultsForWinLoss(new Date(`${addDays(start.ytd, -1)}T00:00:00Z`).toISOString());
  const merges = db.getStrategyMerges();
  /** The line a strategy is reported on: its own name, or the one it was merged into. */
  const reportedAs = (key: string, label: string): string => merges[key] ?? label;

  // gkey = the reported line; key = the original strategy, which still decides the stake and odds.
  interface Priced { day: string; time: string; key: string; gkey: string; profit: number }
  const priced: Priced[] = [];
  const tally = new Map<string, WinLossStrategy>();
  /** Strategies with at least one settled pick in the chosen mode; only these get a line of their own. */
  const inMode = new Set<string>();
  const commission = settings.commission / 100;

  for (const r of rows) {
    const day = ukDay.format(new Date(r.firstSeenAt));
    if (day < start.ytd || day > today) continue;

    const label = strategyLabel(r.strategy);
    const key = label.toLowerCase();
    const t =
      tally.get(key) ??
      {
        label,
        key,
        market: r.market,
        stake: sending.stakes[key] ?? null,
        assumedOdds: settings.assumedOdds[key] ?? null,
        settled: 0,
        counted: 0,
        noStake: 0,
        noOdds: 0,
        notPlaced: 0,
        usedAlertOdds: 0,
      };
    t.market = r.market ?? t.market;
    tally.set(key, t);
    if (!inPickMode(r.placement, mode)) continue;
    t.settled++;
    inMode.add(key);

    const out = priceResult(r, { strategyStake: sending.stakes[key] ?? null, assumedOdds: settings.assumedOdds[key] ?? null, commission });
    if (out.kind === "noStake") {
      t.noStake++;
      continue;
    }
    if (out.kind === "noOdds") {
      t.noOdds++;
      continue;
    }
    if (out.kind === "notPlaced") {
      t.notPlaced++;
      continue;
    }
    t.counted++;
    if (out.usedAlertOdds) t.usedAlertOdds++;
    priced.push({ day, time: ukTime.format(new Date(r.firstSeenAt)), key, gkey: reportedAs(key, label).toLowerCase(), profit: out.profit });
  }

  // ---- expenditure: months charged in a period ----
  // A real cost, so it comes off the Live and All figures but not Sim: Sim shows what a strategy makes by itself.
  const ex = { ...settings.expenditure, enabled: settings.expenditure.enabled && mode !== "sim" };
  const monthsCharged = (periodStart: string): number => {
    if (!ex.enabled || ex.startMonth === null) return 0;
    const from = periodStart.slice(0, 7) > ex.startMonth ? periodStart.slice(0, 7) : ex.startMonth;
    if (from > month) return 0;
    const [fy, fm] = from.split("-").map(Number) as [number, number];
    const [ty, tm] = month.split("-").map(Number) as [number, number];
    return (ty - fy) * 12 + (tm - fm) + 1;
  };
  const expenditureFor = (p: "d1" | "d7" | "mtd" | "ytd") =>
    p === "mtd" || p === "ytd" ? r2(monthsCharged(start[p]) * ex.monthly) : 0;

  // ---- the lines shown: original strategies grouped by what they are merged into ----
  const lines = new Map<string, WinLossReported & { settled: number }>();
  for (const t of tally.values()) {
    if (mode !== "all" && !inMode.has(t.key)) continue;
    const label = reportedAs(t.key, t.label);
    const gkey = label.toLowerCase();
    const line = lines.get(gkey) ?? { key: gkey, label, members: [], settled: 0 };
    line.members.push(t.key);
    line.settled += t.settled;
    lines.set(gkey, line);
  }
  const reported: WinLossReported[] = [...lines.values()]
    .sort((a, b) => b.settled - a.settled)
    .map(({ key, label, members }) => ({ key, label, members }));

  // ---- period totals ----
  const keys = reported.map((l) => l.key);
  const period = (p: "d1" | "d7" | "mtd" | "ytd"): WinLossPeriod => {
    const strategies: Record<string, number> = {};
    for (const k of keys) strategies[k] = 0;
    let picks = 0;
    for (const x of priced) {
      if (x.day >= start[p]) {
        strategies[x.gkey] = (strategies[x.gkey] ?? 0) + x.profit;
        picks++;
      }
    }
    for (const k of keys) strategies[k] = r2(strategies[k] ?? 0);
    const total = r2(Object.values(strategies).reduce((a, b) => a + b, 0));
    const expenditure = expenditureFor(p);
    return { strategies, total, expenditure, totalAfter: r2(total - expenditure), picks };
  };

  // ---- line graph data ----
  const dailySeries = (p: "d7" | "mtd" | "ytd"): WinLossPoint[] => {
    const byDay = new Map<string, Priced[]>();
    for (const x of priced) if (x.day >= start[p]) (byDay.get(x.day) ?? byDay.set(x.day, []).get(x.day)!).push(x);
    const cum: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    let spent = 0;
    // Starts from £0 the day before, so the first day of a period (the 1st of the month) still draws a line.
    const out: WinLossPoint[] = [{ label: addDays(start[p], -1), total: 0, totalAfter: 0, s: Object.fromEntries(keys.map((k) => [k, 0])) }];
    for (let d = start[p]; d <= today; d = addDays(d, 1)) {
      for (const x of byDay.get(d) ?? []) cum[x.gkey] = (cum[x.gkey] ?? 0) + x.profit;
      // The monthly cost is charged on the 1st, for month and year views only.
      if (p !== "d7" && ex.enabled && ex.startMonth !== null && d.endsWith("-01") && d.slice(0, 7) >= ex.startMonth) {
        spent += ex.monthly;
      }
      const total = Object.values(cum).reduce((a, b) => a + b, 0);
      out.push({ label: d, total: r2(total), totalAfter: r2(total - spent), s: Object.fromEntries(keys.map((k) => [k, r2(cum[k] ?? 0)])) });
    }
    return out;
  };

  const oneDay = (): WinLossPoint[] => {
    const todays = priced.filter((x) => x.day === today);
    if (todays.length === 0) return [];
    const cum: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    const out: WinLossPoint[] = [{ label: "Start", total: 0, totalAfter: 0, s: Object.fromEntries(keys.map((k) => [k, 0])) }];
    for (const x of todays) {
      cum[x.gkey] = (cum[x.gkey] ?? 0) + x.profit;
      const total = Object.values(cum).reduce((a, b) => a + b, 0);
      out.push({ label: x.time, total: r2(total), totalAfter: r2(total), s: Object.fromEntries(keys.map((k) => [k, r2(cum[k] ?? 0)])) });
    }
    return out;
  };

  // ---- month to date, one figure per day (for the Daily Performance bars) ----
  const dayTotals = new Map<string, number>();
  for (const x of priced) if (x.day >= start.mtd) dayTotals.set(x.day, (dayTotals.get(x.day) ?? 0) + x.profit);
  const mtdDaily: Array<{ date: string; pnl: number }> = [];
  for (let d = start.mtd; d <= today; d = addDays(d, 1)) mtdDaily.push({ date: d, pnl: r2(dayTotals.get(d) ?? 0) });

  return {
    mode,
    today,
    settings,
    maxStake: sending.maxStake,
    strategies: [...tally.values()].sort((a, b) => b.settled - a.settled),
    reported,
    periods: { d1: period("d1"), d7: period("d7"), mtd: period("mtd"), ytd: period("ytd") },
    mtdDaily,
    series: { d1: oneDay(), d7: dailySeries("d7"), mtd: dailySeries("mtd"), ytd: dailySeries("ytd") },
  };
}

// ---------------------------------------------------------------------------

/** Money figures for one strategy in one mode, all time (from any fresh start). */
export interface StrategyReturn {
  /** Settled picks in this mode. */
  settled: number;
  hits: number;
  /** Of those, the ones that could be priced (stake and odds known, and for Sim, placed under the feed's rules). */
  counted: number;
  staked: number;
  profit: number;
  /** Profit per pound staked (0.12 = 12p back for every £1), or null when nothing was staked. */
  roi: number | null;
  /** Mean odds of the settled picks whose price is known (alert price, else the strategy's assumed odds). */
  avgOdds: number | null;
  /** Hit rate needed to break even at avgOdds after commission, percent. */
  breakeven: number | null;
  /** Where the true hit rate probably is (95% range), percents. */
  range: { low: number; high: number } | null;
  /** Biggest fall in £ from a high point of the running profit to a later low. Positive number, 0 when it never fell. */
  maxDrawdown: number;
  /** Most losing picks in a row, ever. */
  longestLosingRun: number;
  /** Worst UK day in £, or null with nothing priced. */
  worstDay: { day: string; profit: number } | null;
  /** Most losing picks in a row inside one UK day (what the daily "losses in a row" stop counts). */
  worstDayRun: number;
  /** Of the priced picks, how many were priced at the strategy's assumed odds (a guess, not a real price). */
  assumed: number;
}

/** One pick on a strategy's equity curve. */
export interface EquityPoint {
  at: string;
  result: "hit" | "miss";
  profit: number;
  /** Running profit after this pick. */
  total: number;
}

type ResultRow = ReturnType<EngineDb["listResultsForWinLoss"]>[number];

/** Builds a StrategyReturn pick by pick, in time order. */
class ReturnTally {
  private settled = 0;
  private hits = 0;
  private counted = 0;
  private assumed = 0;
  private staked = 0;
  private profit = 0;
  private oddsSum = 0;
  private oddsN = 0;
  private peak = 0;
  private maxDrawdown = 0;
  private run = 0;
  private longestRun = 0;
  private dayRun = 0;
  private worstDayRun = 0;
  private lastDay: string | null = null;
  private days = new Map<string, number>();
  readonly points: EquityPoint[] = [];

  constructor(private readonly commission: number) {}

  get oddsCount(): number {
    return this.oddsN;
  }

  add(r: ResultRow, priced: ReturnType<typeof priceResult>, odds: number | null): void {
    const day = ukDay.format(new Date(r.firstSeenAt));
    this.settled++;
    if (r.result === "hit") this.hits++;
    if (odds !== null) {
      this.oddsSum += odds;
      this.oddsN++;
    }
    // Losing runs count every settled pick, priced or not: a miss is a miss.
    if (day !== this.lastDay) this.dayRun = 0;
    this.lastDay = day;
    if (r.result === "miss") {
      this.run++;
      this.dayRun++;
      this.longestRun = Math.max(this.longestRun, this.run);
      this.worstDayRun = Math.max(this.worstDayRun, this.dayRun);
    } else {
      this.run = 0;
      this.dayRun = 0;
    }
    if (priced.kind !== "priced") return;
    this.counted++;
    if (priced.oddsSource === "assumed") this.assumed++;
    this.staked += priced.stake;
    this.profit += priced.profit;
    this.peak = Math.max(this.peak, this.profit);
    this.maxDrawdown = Math.max(this.maxDrawdown, this.peak - this.profit);
    this.days.set(day, (this.days.get(day) ?? 0) + priced.profit);
    this.points.push({ at: r.firstSeenAt, result: r.result, profit: r2(priced.profit), total: r2(this.profit) });
  }

  result(): StrategyReturn {
    const staked = r2(this.staked);
    const profit = r2(this.profit);
    const avgOdds = this.oddsN > 0 ? Math.round((this.oddsSum / this.oddsN) * 100) / 100 : null;
    let worstDay: StrategyReturn["worstDay"] = null;
    for (const [day, p] of this.days) if (worstDay === null || p < worstDay.profit) worstDay = { day, profit: r2(p) };
    return {
      settled: this.settled,
      hits: this.hits,
      counted: this.counted,
      staked,
      profit,
      roi: staked > 0 ? Math.round((profit / staked) * 1000) / 1000 : null,
      avgOdds,
      breakeven: breakevenHitRate(avgOdds, this.commission),
      range: hitRateRange(this.hits, this.settled),
      maxDrawdown: r2(this.maxDrawdown),
      longestLosingRun: this.longestRun,
      worstDay,
      worstDayRun: this.worstDayRun,
      assumed: this.assumed,
    };
  }
}

/** Prices any settled pick exactly as Win/Loss does: its £ outcome and the odds it is judged at. */
export function pricingInputs(db: EngineDb) {
  const settings = getWinLossSettings(db);
  const sending = getSendingSettings(db);
  const commission = settings.commission / 100;
  return {
    commission,
    /** With `estimate`, the app's own estimate even for a pick with a real Betfair bet (Reconcile compares the two). */
    price: (r: ResultRow, opts: { estimate?: boolean } = {}) => {
      const key = strategyLabel(r.strategy).toLowerCase();
      const assumed = settings.assumedOdds[key] ?? null;
      const priced = priceResult(r, { strategyStake: sending.stakes[key] ?? null, assumedOdds: assumed, commission, estimate: opts.estimate });
      // The odds it is judged at: the price it was actually priced at, else the best price known for it.
      return { key, priced, odds: priced.kind === "priced" ? priced.odds : oddsFor(r, assumed) };
    },
  };
}

/**
 * Live, Sim and All returns for every strategy (keyed by lower-case name), for the Strategies page. Worked out pick by
 * pick exactly as Win/Loss does, so the two always agree. Merged strategies are not combined here. With `sinceIso`, only
 * picks from then on count.
 */
export function computeStrategyReturns(db: EngineDb, sinceIso: string | null = null): Record<string, { live: StrategyReturn; sim: StrategyReturn; all: StrategyReturn }> {
  const { commission, price } = pricingInputs(db);
  const tallies = new Map<string, { live: ReturnTally; sim: ReturnTally; all: ReturnTally }>();
  for (const r of db.listResultsForWinLoss(sinceIso ?? "1970-01-01T00:00:00.000Z")) {
    const { key, priced, odds } = price(r);
    let t = tallies.get(key);
    if (!t) tallies.set(key, (t = { live: new ReturnTally(commission), sim: new ReturnTally(commission), all: new ReturnTally(commission) }));
    if (isLivePlacement(r.placement)) t.live.add(r, priced, odds);
    else if (r.placement === "sim") t.sim.add(r, priced, odds);
    t.all.add(r, priced, odds);
  }
  const out: Record<string, { live: StrategyReturn; sim: StrategyReturn; all: StrategyReturn }> = {};
  for (const [key, t] of tallies) out[key] = { live: t.live.result(), sim: t.sim.result(), all: t.all.result() };
  return out;
}

/** One strategy's running profit, pick by pick, with the same figures as computeStrategyReturns. */
export function computeStrategyEquity(db: EngineDb, label: string, mode: PickMode): { points: EquityPoint[]; summary: StrategyReturn } {
  const { commission, price } = pricingInputs(db);
  const wanted = strategyLabel(label).toLowerCase();
  const t = new ReturnTally(commission);
  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")) {
    if (!inPickMode(r.placement, mode)) continue;
    const { key, priced, odds } = price(r);
    if (key === wanted) t.add(r, priced, odds);
  }
  return { points: t.points, summary: t.result() };
}

/** What a headline hit rate needs beside it to be judged: the odds it was won at, the hit rate those odds need, and its range. */
export interface HitRateContext {
  settled: number;
  hits: number;
  range: { low: number; high: number } | null;
  /** Settled picks whose price is known, and their mean odds. */
  oddsKnown: number;
  avgOdds: number | null;
  breakeven: number | null;
  /** Picks that could be priced in £, and the return on each £1 staked on them. */
  counted: number;
  roi: number | null;
  /** Profit and stakes in £ over those priced picks (admin only, like roi). */
  profit: number;
  staked: number;
  /** Of the priced picks, how many were priced at an assumed price (a guess). */
  assumed: number;
}

/** The Dashboard's hit-rate context, over exactly the settled picks its hit rate counts (ids from EngineDb.statsSettledIds). */
export function computeHitRateContext(db: EngineDb, ids: Set<number>, sinceIso: string | null): HitRateContext {
  const { commission, price } = pricingInputs(db);
  const t = new ReturnTally(commission);
  for (const r of db.listResultsForWinLoss(sinceIso ?? "1970-01-01T00:00:00.000Z")) {
    if (!ids.has(r.id)) continue;
    const { priced, odds } = price(r);
    t.add(r, priced, odds);
  }
  const s = t.result();
  return {
    settled: s.settled,
    hits: s.hits,
    range: s.range,
    oddsKnown: t.oddsCount,
    avgOdds: s.avgOdds,
    breakeven: s.breakeven,
    counted: s.counted,
    roi: s.roi,
    profit: s.profit,
    staked: s.staked,
    assumed: s.assumed,
  };
}

/**
 * Profit in pounds for each settled pick since a date (keyed by pick id), for the admin's Trade Log. Picks
 * that can't be priced, or that the feed's rules would have held back, are left out.
 */
export function computePickProfits(db: EngineDb, sinceIso: string): Record<number, PickProfit> {
  const { price } = pricingInputs(db);
  const out: Record<number, PickProfit> = {};
  for (const r of db.listResultsForWinLoss(sinceIso)) {
    const { priced } = price(r);
    const placement = r.placement;
    if (priced.kind === "priced") {
      out[r.id] = { stake: r2(priced.stake), profit: r2(priced.profit), placement, real: placement === "betfair", assumed: priced.oddsSource === "assumed" };
    } else if (placement === "notPlaced") out[r.id] = { stake: 0, profit: 0, placement, real: false, assumed: false };
  }
  return out;
}

/**
 * A settled pick's money for the Trade Log: what was staked and won or lost, how it was bet (see Placement), and
 * whether the figure is real (from the matched Betfair bet) or an estimate. A pick sent but never placed has 0 / 0.
 */
export interface PickProfit {
  stake: number;
  profit: number;
  placement: Placement;
  real: boolean;
  /** Priced at the strategy's assumed odds (a guess), not a real price. */
  assumed: boolean;
}
