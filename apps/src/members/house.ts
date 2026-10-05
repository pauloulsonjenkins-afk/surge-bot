/**
 * HOUSE performance: how each official strategy has done, worked out from its settled alerts. Never mixed with a
 * member's own bets (stats.ts) or community strategies (community.ts).
 *
 * Definitions (MEMBERS_PLATFORM.md has the full list):
 *   win / loss     an alert settled Hit / Miss (amended results win over the alert's own; excluded alerts don't count)
 *   hit rate       wins / (wins + losses); unsettled alerts are never counted
 *   house money    a level £10 on every settled alert whose price is known, at that price (the alert's own, the price
 *                  matched on Betfair, or Betfair's price when the alert arrived; never an assumed price), less
 *                  commission on winnings. So the house figure doesn't change when the admin changes a stake.
 *   ROI            profit / staked x 100
 *   drawdown       the largest fall from a high point of the running profit
 * The same Fresh start floor as the rest of the site applies.
 */
import type { EngineDb } from "../storage/engine-db";
import { pickOdds } from "../server/pricing";
import { addDaysUk, ukWeekStart } from "./time";
import { ukDateOf, ukDayBounds } from "../server/uk-time";
import { memberStrategyKey } from "./catalogue";

export const HOUSE_UNIT_STAKE = 10;

export interface WinLoss {
  wins: number;
  losses: number;
  /** Percent, one decimal; null with nothing settled. */
  hitRate: number | null;
}

export interface MoneyFigures {
  /** Settled alerts with a known price (the ones in the money figures). */
  priced: number;
  staked: number;
  returns: number;
  profit: number;
  /** Percent, one decimal; null with nothing priced. */
  roi: number | null;
  avgOdds: number | null;
  maxDrawdown: number;
  longestLosingRun: number;
}

export interface HouseStrategyStats {
  key: string;
  today: WinLoss;
  week: WinLoss;
  last30: WinLoss;
  all: WinLoss & MoneyFigures;
  last30Money: MoneyFigures;
  /** Average settled alerts per week over the last 30 days. */
  perWeek: number;
  /** One point per UK day over the last 30 days. */
  daily: Array<{ date: string; wins: number; losses: number; profit: number }>;
  lastAlertAt: string | null;
}

export function hitRate(wins: number, losses: number): number | null {
  const n = wins + losses;
  return n === 0 ? null : Math.round((wins / n) * 1000) / 10;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Running money figures over settled bets, in order. Used for house, member and community figures alike. */
export class MoneyTally {
  priced = 0;
  staked = 0;
  returns = 0;
  profit = 0;
  oddsSum = 0;
  private peak = 0;
  maxDrawdown = 0;
  private losing = 0;
  longestLosingRun = 0;

  add(stake: number, odds: number, won: boolean, commission: number): number {
    const p = won ? stake * (odds - 1) * (1 - commission) : -stake;
    this.priced++;
    this.staked += stake;
    this.returns += won ? stake + p : 0;
    this.profit += p;
    this.oddsSum += odds;
    this.peak = Math.max(this.peak, this.profit);
    this.maxDrawdown = Math.max(this.maxDrawdown, this.peak - this.profit);
    this.losing = won ? 0 : this.losing + 1;
    this.longestLosingRun = Math.max(this.longestLosingRun, this.losing);
    return p;
  }

  /** A bet settled with a known profit (a real Betfair bet, a void). */
  addProfit(stake: number, profit: number, odds: number | null): void {
    this.priced++;
    this.staked += stake;
    this.returns += stake + profit;
    this.profit += profit;
    if (odds !== null) this.oddsSum += odds;
    this.peak = Math.max(this.peak, this.profit);
    this.maxDrawdown = Math.max(this.maxDrawdown, this.peak - this.profit);
    this.losing = profit < 0 ? this.losing + 1 : profit > 0 ? 0 : this.losing;
    this.longestLosingRun = Math.max(this.longestLosingRun, this.losing);
  }

  result(): MoneyFigures {
    return {
      priced: this.priced,
      staked: r2(this.staked),
      returns: r2(this.returns),
      profit: r2(this.profit),
      roi: this.staked > 0 ? Math.round((this.profit / this.staked) * 1000) / 10 : null,
      avgOdds: this.priced > 0 && this.oddsSum > 0 ? r2(this.oddsSum / this.priced) : null,
      maxDrawdown: r2(this.maxDrawdown),
      longestLosingRun: this.longestLosingRun,
    };
  }
}

const memo = new WeakMap<EngineDb, { version: number; at: number; commission: number; value: Map<string, HouseStrategyStats> }>();

/**
 * Every strategy's house figures, keyed by member strategy key. Worked out once and reused until the data changes
 * (or a minute passes, so "today" rolls over), so a busy platform doesn't re-read every alert on every page.
 */
export function houseStats(db: EngineDb, commissionPct: number, now = new Date()): Map<string, HouseStrategyStats> {
  const hit = memo.get(db);
  const version = db.changeCount();
  if (hit && hit.version === version && hit.commission === commissionPct && now.getTime() - hit.at < 60_000) return hit.value;
  const value = computeHouseStats(db, commissionPct, now);
  memo.set(db, { version, at: now.getTime(), commission: commissionPct, value });
  return value;
}

export function computeHouseStats(db: EngineDb, commissionPct: number, now = new Date()): Map<string, HouseStrategyStats> {
  const commission = commissionPct / 100;
  const merges = db.getStrategyMerges();
  const today = ukDateOf(now);
  const todayFrom = ukDayBounds(today).from;
  const weekFrom = ukDayBounds(ukWeekStart(today)).from;
  const d30Date = addDaysUk(today, -29);
  const d30From = ukDayBounds(d30Date).from;

  interface Acc {
    today: [number, number];
    week: [number, number];
    last30: [number, number];
    all: [number, number];
    money: MoneyTally;
    money30: MoneyTally;
    daily: Map<string, { wins: number; losses: number; profit: number }>;
    lastAlertAt: string | null;
  }
  const accs = new Map<string, Acc>();
  const acc = (key: string): Acc => {
    let a = accs.get(key);
    if (!a)
      accs.set(
        key,
        (a = { today: [0, 0], week: [0, 0], last30: [0, 0], all: [0, 0], money: new MoneyTally(), money30: new MoneyTally(), daily: new Map(), lastAlertAt: null }),
      );
    return a;
  };

  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")) {
    const key = memberStrategyKey(merges, r.strategy);
    const a = acc(key);
    const won = r.result === "hit";
    const i = won ? 0 : 1;
    a.all[i]++;
    if (r.firstSeenAt >= d30From) a.last30[i]++;
    if (r.firstSeenAt >= weekFrom) a.week[i]++;
    if (r.firstSeenAt >= todayFrom) a.today[i]++;
    const found = pickOdds(r, null);
    let profit = 0;
    if (found) {
      profit = a.money.add(HOUSE_UNIT_STAKE, found.odds, won, commission);
      if (r.firstSeenAt >= d30From) a.money30.add(HOUSE_UNIT_STAKE, found.odds, won, commission);
    }
    if (r.firstSeenAt >= d30From) {
      const day = ukDateOf(new Date(r.firstSeenAt));
      const d = a.daily.get(day) ?? { wins: 0, losses: 0, profit: 0 };
      if (won) d.wins++;
      else d.losses++;
      d.profit = r2(d.profit + profit);
      a.daily.set(day, d);
    }
  }
  // Last alert of each strategy, settled or not.
  for (const p of db.listLivePicks(200)) {
    if (p.excluded) continue;
    const a = acc(memberStrategyKey(merges, p.strategy));
    if (!a.lastAlertAt || p.firstSeenAt > a.lastAlertAt) a.lastAlertAt = p.firstSeenAt;
  }

  const days: string[] = [];
  for (let i = 0; i < 30; i++) days.push(addDaysUk(d30Date, i));
  const wl = ([w, l]: [number, number]): WinLoss => ({ wins: w, losses: l, hitRate: hitRate(w, l) });
  const out = new Map<string, HouseStrategyStats>();
  for (const [key, a] of accs) {
    out.set(key, {
      key,
      today: wl(a.today),
      week: wl(a.week),
      last30: wl(a.last30),
      all: { ...wl(a.all), ...a.money.result() },
      last30Money: a.money30.result(),
      perWeek: Math.round(((a.last30[0] + a.last30[1]) / (30 / 7)) * 10) / 10,
      daily: days.map((date) => ({ date, ...(a.daily.get(date) ?? { wins: 0, losses: 0, profit: 0 }) })),
      lastAlertAt: a.lastAlertAt,
    });
  }
  return out;
}

export function emptyHouseStats(key: string): HouseStrategyStats {
  const wl: WinLoss = { wins: 0, losses: 0, hitRate: null };
  const money = new MoneyTally().result();
  return { key, today: wl, week: wl, last30: wl, all: { ...wl, ...money }, last30Money: money, perWeek: 0, daily: [], lastAlertAt: null };
}
