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
 * Expenditure is a fixed monthly cost. It is OFF unless it has been ticked, and
 * it applies to the Month and Year figures only, charged on the 1st of each
 * month from the start month onwards.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings, strategyLabel } from "../inplayguru/bet-feed";

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
  today: string;
  settings: WinLossSettings;
  maxStake: number;
  /** Each original strategy, with its stake and assumed odds. These are settings, so merged strategies stay separate here. */
  strategies: WinLossStrategy[];
  /** The lines the figures and graph show: merged strategies appear once. */
  reported: WinLossReported[];
  periods: { d1: WinLossPeriod; d7: WinLossPeriod; mtd: WinLossPeriod; ytd: WinLossPeriod };
  series: { d1: WinLossPoint[]; d7: WinLossPoint[]; mtd: WinLossPoint[]; ytd: WinLossPoint[] };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeWinLoss(db: EngineDb, now = new Date()): WinLossState {
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
        usedAlertOdds: 0,
      };
    t.settled++;
    t.market = r.market ?? t.market;
    tally.set(key, t);

    const stake = r.sentStake ?? sending.stakes[key] ?? null;
    if (stake === null) {
      t.noStake++;
      continue;
    }
    // The price printed in the alert counts only when it is for the very line that was bet.
    const alertOdds =
      r.market === "NEXT_GOAL" && r.targetLine !== null && r.overLine === r.targetLine && r.overOdds !== null && r.overOdds > 1
        ? r.overOdds
        : null;
    const odds = alertOdds ?? settings.assumedOdds[key] ?? null;
    if (odds === null) {
      t.noOdds++;
      continue;
    }
    t.counted++;
    if (alertOdds !== null) t.usedAlertOdds++;

    const profit = r.result === "hit" ? stake * (odds - 1) * (1 - commission) : -stake;
    priced.push({ day, time: ukTime.format(new Date(r.firstSeenAt)), key, gkey: reportedAs(key, label).toLowerCase(), profit });
  }

  // ---- expenditure: months charged in a period ----
  const ex = settings.expenditure;
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
    const out: WinLossPoint[] = [];
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

  return {
    today,
    settings,
    maxStake: sending.maxStake,
    strategies: [...tally.values()].sort((a, b) => b.settled - a.settled),
    reported,
    periods: { d1: period("d1"), d7: period("d7"), mtd: period("mtd"), ytd: period("ytd") },
    series: { d1: oneDay(), d7: dailySeries("d7"), mtd: dailySeries("mtd"), ytd: dailySeries("ytd") },
  };
}