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
import { inPickMode, isLivePlacement, RECORD_FROM, type EngineDb, type PickMode, type Placement } from "../storage/engine-db";
import { getSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { segmentsOf } from "./segments";
import { currentStake } from "../inplayguru/stake";
import { breakevenHitRate, hitRateRange, oddsFor, priceResult } from "./pricing";
import { ukDateOfIso as ukDayOf } from "./uk-time";

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
  periods: { d1: WinLossPeriod; d7: WinLossPeriod; d30: WinLossPeriod; mtd: WinLossPeriod; ytd: WinLossPeriod };
  /** Month to date, one entry per UK day from the 1st to today (days with no settled picks are £0). Before any monthly cost. */
  mtdDaily: Array<{ date: string; pnl: number }>;
  series: { d1: WinLossPoint[]; d7: WinLossPoint[]; d30: WinLossPoint[]; mtd: WinLossPoint[]; ytd: WinLossPoint[] };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Each strategy's stake today, worked out once per report: it depends on the settings and the balance, never on the
 * pick. Reading the balance for every pick took about half of each report's time.
 */
function stakeLookup(db: EngineDb, sending: ReturnType<typeof getSendingSettings>): (key: string) => number | null {
  const known = new Map<string, number | null>();
  return (key) => {
    let s = known.get(key);
    if (s === undefined) known.set(key, (s = currentStake(db, sending, key)));
    return s;
  };
}


export function computeWinLoss(db: EngineDb, now = new Date(), mode: PickMode = "all"): WinLossState {
  const settings = getWinLossSettings(db);
  const sending = getSendingSettings(db);
  const today = ukDay.format(now);
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const start = { d1: today, d7: addDays(today, -6), d30: addDays(today, -29), mtd: `${month}-01`, ytd: `${year}-01-01` };
  // The last 30 days reach back into last year in January; the strategy table still counts this year only.
  const earliest = start.d30 < start.ytd ? start.d30 : start.ytd;

  // A day of margin before the earliest start; the exact UK day is checked below.
  const rows = db.listResultsForWinLoss(new Date(`${addDays(earliest, -1)}T00:00:00Z`).toISOString());
  const merges = db.getStrategyMerges();
  /** The line a strategy is reported on: its own name, or the one it was merged into. */
  const reportedAs = (key: string, label: string): string => merges[key] ?? label;

  // gkey = the reported line; key = the original strategy, which still decides the stake and odds. time: the UK time of
  // day, for the one-day graph, so only today's picks need it.
  interface Priced { day: string; time: string; key: string; gkey: string; profit: number }
  const timeOf = (day: string, at: string) => (day === today ? ukTime.format(new Date(at)) : "");
  const priced: Priced[] = [];
  const tally = new Map<string, WinLossStrategy>();
  /** Strategies with at least one settled pick in the chosen mode; only these get a line of their own. */
  const inMode = new Set<string>();
  const commission = settings.commission / 100;
  const stakeOf = stakeLookup(db, sending);

  for (const r of rows) {
    const day = ukDayOf(r.firstSeenAt);
    if (day < earliest || day > today) continue;
    // Before this year (January's 30-day view only): priced for that view, but not in the year's table.
    if (day < start.ytd) {
      if (!inPickMode(r.placement, mode)) continue;
      const k = strategyLabel(r.strategy).toLowerCase();
      const out = priceResult(r, { strategyStake: stakeOf(k), assumedOdds: settings.assumedOdds[k] ?? null, commission: settings.commission / 100 });
      if (out.kind === "priced") priced.push({ day, time: timeOf(day, r.firstSeenAt), key: k, gkey: reportedAs(k, strategyLabel(r.strategy)).toLowerCase(), profit: out.profit });
      continue;
    }

    const label = strategyLabel(r.strategy);
    const key = label.toLowerCase();
    const t =
      tally.get(key) ??
      {
        label,
        key,
        market: r.market,
        stake: stakeOf(key),
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

    const out = priceResult(r, { strategyStake: stakeOf(key), assumedOdds: settings.assumedOdds[key] ?? null, commission });
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
    priced.push({ day, time: timeOf(day, r.firstSeenAt), key, gkey: reportedAs(key, label).toLowerCase(), profit: out.profit });
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
  const expenditureFor = (p: "d1" | "d7" | "d30" | "mtd" | "ytd") =>
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
  const period = (p: "d1" | "d7" | "d30" | "mtd" | "ytd"): WinLossPeriod => {
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
  const dailySeries = (p: "d7" | "d30" | "mtd" | "ytd"): WinLossPoint[] => {
    const byDay = new Map<string, Priced[]>();
    for (const x of priced) if (x.day >= start[p]) (byDay.get(x.day) ?? byDay.set(x.day, []).get(x.day)!).push(x);
    const cum: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    let spent = 0;
    // Starts from £0 the day before, so the first day of a period (the 1st of the month) still draws a line.
    const out: WinLossPoint[] = [{ label: addDays(start[p], -1), total: 0, totalAfter: 0, s: Object.fromEntries(keys.map((k) => [k, 0])) }];
    for (let d = start[p]; d <= today; d = addDays(d, 1)) {
      for (const x of byDay.get(d) ?? []) cum[x.gkey] = (cum[x.gkey] ?? 0) + x.profit;
      // The monthly cost is charged on the 1st, for month and year views only.
      if ((p === "mtd" || p === "ytd") && ex.enabled && ex.startMonth !== null && d.endsWith("-01") && d.slice(0, 7) >= ex.startMonth) {
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
    periods: { d1: period("d1"), d7: period("d7"), d30: period("d30"), mtd: period("mtd"), ytd: period("ytd") },
    mtdDaily,
    series: { d1: oneDay(), d7: dailySeries("d7"), d30: dailySeries("d30"), mtd: dailySeries("mtd"), ytd: dailySeries("ytd") },
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
  /**
   * Hits among the priced picks, and their likely range: the hit rate to judge against break-even, since it is over the
   * same picks as the money (a hit rate over every settled pick can disagree with it).
   */
  pricedHits: number;
  pricedRange: { low: number; high: number } | null;
  staked: number;
  profit: number;
  /** Profit per pound staked (0.12 = 12p back for every £1), or null when nothing was staked. */
  roi: number | null;
  /** Mean odds of the settled picks whose price is known (alert price, else the strategy's assumed odds). */
  avgOdds: number | null;
  /** Hit rate needed to break even at avgOdds after commission, percent. */
  breakeven: number | null;
  /**
   * Hit rate needed to break even given what these picks' winners actually paid and what their losers actually cost,
   * percent: average stake lost per miss / (average winnings per win + average stake lost per miss). Unlike `breakeven`,
   * it isn't thrown off when the winners were at shorter prices than the losers. Null until there is a win and a loss
   * among the priced picks.
   */
  breakevenEffective: number | null;
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

export type ResultRow = ReturnType<EngineDb["listResultsForWinLoss"]>[number];

export const ALL_TIME = "1970-01-01T00:00:00.000Z";

/**
 * The settled picks from `sinceIso` on (null = all time). With `shared` (every settled pick, as
 * db.listResultsForWinLoss(ALL_TIME) gives them), the same picks are taken from it instead of being read again: one
 * read can then serve several reports worked out together. Those rows are only ever read, never changed.
 */
export function settledSince(db: EngineDb, sinceIso: string | null, shared?: ResultRow[]): ResultRow[] {
  if (!shared) return db.listResultsForWinLoss(sinceIso ?? ALL_TIME);
  return sinceIso === null ? shared : shared.filter((r) => r.firstSeenAt >= sinceIso);
}

/** Builds a StrategyReturn pick by pick, in time order. */
/**
 * The hit rate at which profit would be nil, if wins kept paying `avgWin` (£ won per winning pick, after commission) and
 * losses kept costing `avgLoss` (£ lost per losing pick): avgLoss / (avgWin + avgLoss), as a percent to 1 d.p.
 */
export function effectiveBreakeven(avgWin: number, avgLoss: number): number | null {
  if (!(avgWin > 0) || !(avgLoss > 0)) return null;
  return Math.round((1000 * avgLoss) / (avgWin + avgLoss)) / 10;
}

class ReturnTally {
  private settled = 0;
  private hits = 0;
  private counted = 0;
  private assumed = 0;
  private staked = 0;
  private profit = 0;
  private winSum = 0;
  private winN = 0;
  private lossSum = 0;
  private lossN = 0;
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
    const day = ukDayOf(r.firstSeenAt);
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
    if (r.result === "hit") {
      this.winSum += priced.profit;
      this.winN++;
    } else {
      this.lossSum += priced.stake;
      this.lossN++;
    }
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
      pricedHits: this.winN,
      pricedRange: hitRateRange(this.winN, this.counted),
      staked,
      profit,
      roi: staked > 0 ? Math.round((profit / staked) * 1000) / 1000 : null,
      avgOdds,
      breakeven: breakevenHitRate(avgOdds, this.commission),
      breakevenEffective: this.winN > 0 && this.lossN > 0 ? effectiveBreakeven(this.winSum / this.winN, this.lossSum / this.lossN) : null,
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
  const stakeOf = stakeLookup(db, sending);
  return {
    commission,
    /** With `estimate`, the app's own estimate even for a pick with a real Betfair bet (Reconcile compares the two). */
    price: (r: ResultRow, opts: { estimate?: boolean } = {}) => {
      const key = strategyLabel(r.strategy).toLowerCase();
      const assumed = settings.assumedOdds[key] ?? null;
      const priced = priceResult(r, { strategyStake: stakeOf(key), assumedOdds: assumed, commission, estimate: opts.estimate });
      // The odds it is judged at: the price it was actually priced at, else the best price known for it.
      return { key, priced, odds: priced.kind === "priced" ? priced.odds : oddsFor(r, assumed) };
    },
  };
}

type ModeReturns = { live: StrategyReturn; sim: StrategyReturn; all: StrategyReturn };

/** A slice watched on a strategy's card (segments.ts): its record, and the rest of the strategy's. */
export interface SegmentReturns {
  id: string;
  label: string;
  /** Counted from here. */
  since: string;
  /** Added from the Golden finder. */
  custom: boolean;
  /** Added by the finder itself, quietly (golden.ts); still false once it's promoted, since promotion only notifies. */
  auto: boolean;
  in: ModeReturns;
  out: ModeReturns;
}

/** Best Value Cuppa's bet types, for splitting its record (Unders are being watched as a strategy of their own). */
export type EdgeBetKind = "unders" | "overs" | "btts" | "result";
export function edgeBetKind(bet: { market: string; pick: string }): EdgeBetKind {
  if (bet.market === "MO" || bet.market === "DC") return "result";
  if (bet.market === "BTTS") return "btts";
  return bet.pick === "under" || bet.pick === "no" ? "unders" : "overs";
}

/**
 * Live, Sim and All returns for every strategy (keyed by lower-case name), for the Strategies page. Worked out pick by
 * pick exactly as Win/Loss does, so the two always agree. Merged strategies are not combined here. With `sinceIso`, only
 * picks from then on count.
 *
 * With `fromRuleChange`, a strategy whose rules changed (RECORD_FROM) counts its money from the change too, like its
 * win / loss record, and its picks from before go to `before` instead (shown smaller, so nothing is hidden).
 * `rows`: every settled pick, already read (see settledSince).
 */
export function computeStrategyReturns(
  db: EngineDb,
  sinceIso: string | null = null,
  opts: { fromRuleChange?: boolean; rows?: ResultRow[] } = {},
): Record<string, ModeReturns & { before?: ModeReturns; byBet?: Partial<Record<EdgeBetKind, ModeReturns>>; byHand?: StrategyReturn; segments?: SegmentReturns[] }> {
  const { commission, price } = pricingInputs(db);
  const fresh = () => ({ live: new ReturnTally(commission), sim: new ReturnTally(commission), all: new ReturnTally(commission) });
  const tallies = new Map<
    string,
    { now: ReturnType<typeof fresh>; before: ReturnType<typeof fresh> | null; byBet?: Map<EdgeBetKind, ReturnType<typeof fresh>>; byHand?: ReturnTally; segs?: Map<string, { in: ReturnType<typeof fresh>; out: ReturnType<typeof fresh> }> }
  >();
  for (const r of settledSince(db, sinceIso, opts.rows)) {
    const { key, priced, odds } = price(r);
    let t = tallies.get(key);
    if (!t) tallies.set(key, (t = { now: fresh(), before: null }));
    const changed = opts.fromRuleChange ? RECORD_FROM[key] : undefined;
    const into = changed && r.firstSeenAt < changed ? (t.before ??= fresh()) : t.now;
    const targets = [into];
    // Best Value Cuppa: also by bet type (from its rule change too, like the headline).
    if (r.edgeBet && into === t.now) {
      const kind = edgeBetKind(r.edgeBet);
      t.byBet ??= new Map();
      let k = t.byBet.get(kind);
      if (!k) t.byBet.set(kind, (k = fresh()));
      targets.push(k);
    }
    // A slice being watched on the card (segments.ts): this pick's record goes to the slice, or to the rest.
    const segs = segmentsOf(key);
    if (segs.length > 0 && r.facts && into === t.now) {
      t.segs ??= new Map();
      for (const seg of segs) {
        if (r.firstSeenAt < seg.since) continue;
        let s = t.segs.get(seg.id);
        if (!s) t.segs.set(seg.id, (s = { in: fresh(), out: fresh() }));
        targets.push(seg.test(r.facts) ? s.in : s.out);
      }
    }
    // A Sim pick bet by hand: its real money is shown on its own (byHand), it stays in the Sim record at its Sim bet,
    // and it is left out of the strategy's Live figures, which the stake ladder and "back to Sim" judge.
    if (r.byHand) {
      if (into === t.now) (t.byHand ??= new ReturnTally(commission)).add(r, priced, odds);
      const shadow = { ...r, placement: "sim" as const, sent: false, sim: r.simShadow, betStake: null, betProfit: null, betOdds: null, takenOdds: null, sentStake: null };
      const s = price(shadow);
      for (const x of targets) {
        if (r.simShadow) x.sim.add(shadow, s.priced, s.odds);
        x.all.add(r, priced, odds);
      }
      continue;
    }
    for (const x of targets) {
      if (isLivePlacement(r.placement)) x.live.add(r, priced, odds);
      else if (r.placement === "sim") x.sim.add(r, priced, odds);
      x.all.add(r, priced, odds);
    }
  }
  const done = (t: ReturnType<typeof fresh>): ModeReturns => ({ live: t.live.result(), sim: t.sim.result(), all: t.all.result() });
  const out: Record<string, ModeReturns & { before?: ModeReturns; byBet?: Partial<Record<EdgeBetKind, ModeReturns>> }> = {};
  for (const [key, t] of tallies) {
    out[key] = {
      ...done(t.now),
      ...(t.before ? { before: done(t.before) } : {}),
      ...(t.byBet ? { byBet: Object.fromEntries([...t.byBet].map(([k, v]) => [k, done(v)])) } : {}),
      ...(t.byHand ? { byHand: t.byHand.result() } : {}),
      ...(t.segs?.size
        ? { segments: segmentsOf(key).filter((s) => t.segs!.has(s.id)).map((s) => ({ id: s.id, label: s.label, since: s.since, custom: s.custom === true, auto: s.auto === true, in: done(t.segs!.get(s.id)!.in), out: done(t.segs!.get(s.id)!.out) })) }
        : {}),
    };
  }
  return out;
}

/**
 * For each strategy with a recorded mode-switch date (SendingSettings.modeSince, set whenever its Live/Sim switch is
 * flipped), its return in its CURRENT mode only, from that switch on. The Strategies page's "Own mode" headline uses
 * this instead of that mode's whole history: reported 27 Oct 2026 - switching Favourite pressure level to Sim
 * immediately showed its big, mostly pre-switch Sim record as if it were evidence the switch had already paid off,
 * when almost none of that record happened since the decision. A strategy with no recorded switch date (never
 * toggled since this was added) is left out; the page falls back to the whole-history figure for those.
 */
export function computeSinceModeReturns(db: EngineDb, modeSince: Record<string, string>, currentMode: Record<string, "live" | "sim">, rows?: ResultRow[]): Record<string, StrategyReturn> {
  const { commission, price } = pricingInputs(db);
  const earliest = Object.values(modeSince).sort()[0] ?? null;
  if (earliest === null) return {};
  const tallies = new Map<string, ReturnTally>();
  for (const r of settledSince(db, earliest, rows)) {
    const { key, priced, odds } = price(r);
    const since = modeSince[key];
    const mode = currentMode[key];
    if (!since || !mode || r.firstSeenAt < since) continue;
    let t = tallies.get(key);
    if (!t) tallies.set(key, (t = new ReturnTally(commission)));
    if (r.byHand) {
      if (mode === "sim" && r.simShadow) {
        const shadow = { ...r, placement: "sim" as const, sent: false, sim: r.simShadow, betStake: null, betProfit: null, betOdds: null, takenOdds: null, sentStake: null };
        const s = price(shadow);
        t.add(shadow, s.priced, s.odds);
      }
      continue;
    }
    if (mode === "live" ? isLivePlacement(r.placement) : r.placement === "sim") t.add(r, priced, odds);
  }
  const out: Record<string, StrategyReturn> = {};
  for (const [key, t] of tallies) out[key] = t.result();
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
  /** At the average odds of every pick (assumes winners and losers were priced alike). */
  breakeven: number | null;
  /** From what the winners actually paid and the losers cost; this is the one the Dashboard judges against. */
  breakevenEffective: number | null;
  /** The same picks split by price, so it shows which price ranges make money. */
  bands: OddsBand[];
  /** Picks that could be priced in £, and the return on each £1 staked on them. */
  counted: number;
  roi: number | null;
  /** Profit and stakes in £ over those priced picks (admin only, like roi). */
  profit: number;
  staked: number;
  /** Of the priced picks, how many were priced at an assumed price (a guess). */
  assumed: number;
}

/** Price ranges for the Dashboard's odds table. `to` is exclusive. */
export const ODDS_BANDS: Array<{ label: string; from: number; to: number }> = [
  { label: "Under 1.50", from: 0, to: 1.5 },
  { label: "1.50 – 1.79", from: 1.5, to: 1.8 },
  { label: "1.80 – 2.19", from: 1.8, to: 2.2 },
  { label: "2.20 and over", from: 2.2, to: Infinity },
];

/** One price range: how often it won, what it needs, and (admin only on the site) what it made. */
export interface OddsBand {
  label: string;
  /** Settled picks in this range whose price is known. */
  settled: number;
  hits: number;
  hitRate: number | null;
  /** Needed to break even in this range (from what its winners paid, else at its average odds). */
  breakeven: number | null;
  counted: number;
  staked: number;
  profit: number;
  roi: number | null;
}

/** The Dashboard's hit-rate context, over exactly the settled picks its hit rate counts (ids from EngineDb.statsSettledIds). */
export function computeHitRateContext(db: EngineDb, ids: Set<number>, sinceIso: string | null): HitRateContext {
  const { commission, price } = pricingInputs(db);
  const t = new ReturnTally(commission);
  const bandTallies = ODDS_BANDS.map(() => new ReturnTally(commission));
  for (const r of db.listResultsForWinLoss(sinceIso ?? "1970-01-01T00:00:00.000Z")) {
    if (!ids.has(r.id)) continue;
    const { priced, odds } = price(r);
    t.add(r, priced, odds);
    if (odds !== null) {
      const i = ODDS_BANDS.findIndex((b) => odds >= b.from && odds < b.to);
      if (i >= 0) bandTallies[i]!.add(r, priced, odds);
    }
  }
  const s = t.result();
  const bands: OddsBand[] = ODDS_BANDS.map((b, i) => {
    const x = bandTallies[i]!.result();
    return {
      label: b.label,
      settled: x.settled,
      hits: x.hits,
      hitRate: x.settled > 0 ? Math.round((x.hits / x.settled) * 1000) / 10 : null,
      breakeven: x.breakevenEffective ?? x.breakeven,
      counted: x.counted,
      staked: x.staked,
      profit: x.profit,
      roi: x.roi,
    };
  });
  return {
    settled: s.settled,
    hits: s.hits,
    range: s.range,
    oddsKnown: t.oddsCount,
    avgOdds: s.avgOdds,
    breakeven: s.breakeven,
    breakevenEffective: s.breakevenEffective,
    bands,
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
      out[r.id] = { stake: r2(priced.stake), profit: r2(priced.profit), placement, real: placement === "betfair", assumed: priced.oddsSource === "assumed", ...(r.byHand ? { byHand: true } : {}) };
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
  /** A Sim pick bet for real by hand (Live tab, Bet this for real). */
  byHand?: boolean;
}

/** One window of a strategy's form: its figures overall and split into Live (real money) and Sim. */
export interface FormWindow {
  all: StrategyReturn;
  live: StrategyReturn;
  sim: StrategyReturn;
  /** The first and last settled pick in the window. */
  from: string | null;
  to: string | null;
  /** The current run: the last result and how many in a row ended that way. */
  streak: { result: "hit" | "miss"; n: number } | null;
  /** The window before this one (the 7 days before, or the 20 picks before), for comparison. */
  before: { settled: number; hits: number };
}

export interface StrategyForm {
  /** The last RECENT_PICKS settled picks. */
  recent: FormWindow;
  /** Settled picks from the last 7 days. */
  week: FormWindow;
  /** For a strategy whose rules changed (RECORD_FROM): the 7 days before the change against everything since. */
  change?: { at: string; before: FormWindow; after: FormWindow };
}

export const RECENT_PICKS = 20;

/**
 * Recent form for every strategy (keyed by lower-case name): its last 20 settled picks, and its last 7 days, each with
 * the window before for comparison. Priced exactly as computeStrategyReturns. A strategy whose rules changed
 * (RECORD_FROM) counts only picks from the change. `rows`: every settled pick, already read (see settledSince).
 */
/**
 * Each strategy's running profit over its last 30 priced bets (Live and Sim together, oldest first), for the sparkline on
 * its Strategies card. From the last 60 days.
 */
export function computeSparks(db: EngineDb, now = new Date(), rows?: ResultRow[], n = 30): Record<string, number[]> {
  const { price } = pricingInputs(db);
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const by = new Map<string, Array<{ at: string; profit: number }>>();
  for (const r of settledSince(db, since, rows)) {
    const p = price(r);
    if (p.priced.kind !== "priced") continue;
    (by.get(p.key) ?? by.set(p.key, []).get(p.key)!).push({ at: r.firstSeenAt, profit: p.priced.profit });
  }
  const out: Record<string, number[]> = {};
  for (const [key, list] of by) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let run = 0;
    out[key] = list.slice(-n).map((x) => Math.round((run += x.profit) * 100) / 100);
  }
  return out;
}

export function computeStrategyForm(db: EngineDb, now = new Date(), rows?: ResultRow[]): Record<string, StrategyForm> {
  const { commission, price } = pricingInputs(db);
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const byKey = new Map<string, Array<{ r: ResultRow; priced: ReturnType<typeof priceResult>; odds: number | null }>>();
  // Picks in the week before a rule change, to compare with the picks since.
  const beforeChange = new Map<string, Array<{ r: ResultRow; priced: ReturnType<typeof priceResult>; odds: number | null }>>();
  for (const r of settledSince(db, since, rows)) {
    const p = price(r);
    const from = RECORD_FROM[p.key];
    if (from && r.firstSeenAt < from) {
      if (r.firstSeenAt >= new Date(Date.parse(from) - 7 * 86_400_000).toISOString())
        (beforeChange.get(p.key) ?? beforeChange.set(p.key, []).get(p.key)!).push({ r, priced: p.priced, odds: p.odds });
      continue;
    }
    (byKey.get(p.key) ?? byKey.set(p.key, []).get(p.key)!).push({ r, priced: p.priced, odds: p.odds });
  }
  const window = (rows: Array<{ r: ResultRow; priced: ReturnType<typeof priceResult>; odds: number | null }>, before: typeof rows): FormWindow => {
    const t = { live: new ReturnTally(commission), sim: new ReturnTally(commission), all: new ReturnTally(commission) };
    for (const x of rows) {
      if (isLivePlacement(x.r.placement)) t.live.add(x.r, x.priced, x.odds);
      else if (x.r.placement === "sim") t.sim.add(x.r, x.priced, x.odds);
      t.all.add(x.r, x.priced, x.odds);
    }
    let streak: FormWindow["streak"] = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const res = rows[i]!.r.result;
      if (!streak) streak = { result: res, n: 1 };
      else if (res === streak.result) streak.n++;
      else break;
    }
    return {
      all: t.all.result(),
      live: t.live.result(),
      sim: t.sim.result(),
      from: rows[0]?.r.firstSeenAt ?? null,
      to: rows[rows.length - 1]?.r.firstSeenAt ?? null,
      streak,
      before: { settled: before.length, hits: before.filter((x) => x.r.result === "hit").length },
    };
  };
  const weekStart = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const prevStart = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const out: Record<string, StrategyForm> = {};
  for (const [key, rows] of byKey) {
    const recent = rows.slice(-RECENT_PICKS);
    const beforeRecent = rows.slice(-2 * RECENT_PICKS, -RECENT_PICKS);
    const week = rows.filter((x) => x.r.firstSeenAt >= weekStart);
    const prevWeek = rows.filter((x) => x.r.firstSeenAt >= prevStart && x.r.firstSeenAt < weekStart);
    out[key] = { recent: window(recent, beforeRecent), week: window(week, prevWeek) };
  }
  for (const [key, from] of Object.entries(RECORD_FROM)) {
    const before = beforeChange.get(key) ?? [];
    const after = byKey.get(key) ?? [];
    if (before.length === 0 && after.length === 0) continue;
    const empty = window([], []);
    out[key] = { ...(out[key] ?? { recent: empty, week: empty }), change: { at: from, before: window(before, []), after: window(after, []) } };
  }
  return out;
}
