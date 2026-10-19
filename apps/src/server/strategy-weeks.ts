/**
 * Strategies → Weekly: each strategy's £ week by week (Monday to Sunday, UK), the last 7 days, and the 4 weeks before
 * them, for the trend label ("Turning up", "Slipping"...). Priced exactly as Profit and the strategy cards
 * (pricingInputs); a Sim pick bet by hand counts like on its card: its real money in All, its Sim bet in Sim, and
 * not in Live (see computeStrategyReturns).
 */
import { isLivePlacement, type EngineDb } from "../storage/engine-db";
import { strategyLabel } from "../inplayguru/bet-feed";
import { pricingInputs } from "./winloss";
import { ukDateOf } from "./uk-time";
import { addDaysUk, ukWeekStart } from "../members/time";

export interface WeekTally {
  /** Settled picks, and how many won and lost. */
  picks: number;
  won: number;
  lost: number;
  /** Priced picks, and their £ staked and profit. */
  counted: number;
  staked: number;
  profit: number;
}
export type WeekModes = { live: WeekTally; sim: WeekTally; all: WeekTally };

export interface StrategyWeeks {
  /** The weeks shown, oldest first: each Monday (YYYY-MM-DD, UK). The last is the current week, so far. */
  weeks: string[];
  /** Lower-case strategy name -> one entry per week, the last 7 days, and the 28 days before them. "__all__" = every strategy. */
  strategies: Record<string, { weeks: WeekModes[]; last7: WeekModes; prev28: WeekModes }>;
}

const empty = (): WeekTally => ({ picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0 });
const modes = (): WeekModes => ({ live: empty(), sim: empty(), all: empty() });
const r2 = (n: number) => Math.round(n * 100) / 100;

function add(t: WeekTally, hit: boolean, priced: { stake: number; profit: number } | null): void {
  t.picks++;
  if (hit) t.won++;
  else t.lost++;
  if (priced && priced.stake > 0) {
    t.counted++;
    t.staked = r2(t.staked + priced.stake);
    t.profit = r2(t.profit + priced.profit);
  }
}

export function computeStrategyWeeks(db: EngineDb, weekCount = 6, now = new Date()): StrategyWeeks {
  const { price } = pricingInputs(db);
  const thisMonday = ukWeekStart(ukDateOf(now));
  const weeks = Array.from({ length: weekCount }, (_, i) => addDaysUk(thisMonday, -7 * (weekCount - 1 - i)));
  const last7From = now.getTime() - 7 * 86_400_000;
  const prev28From = last7From - 28 * 86_400_000;
  const since = new Date(Math.min(Date.parse(`${weeks[0]}T00:00:00Z`) - 3_600_000, prev28From)).toISOString();

  const out: StrategyWeeks["strategies"] = {};
  const entry = (k: string) => (out[k] ??= { weeks: weeks.map(() => modes()), last7: modes(), prev28: modes() });
  for (const r of db.listResultsForWinLoss(since)) {
    const at = Date.parse(r.firstSeenAt);
    const w = weeks.indexOf(ukWeekStart(ukDateOf(new Date(at))));
    const buckets: WeekModes[] = [];
    for (const k of [strategyLabel(r.strategy).toLowerCase(), "__all__"]) {
      const e = entry(k);
      if (w >= 0) buckets.push(e.weeks[w]!);
      if (at >= last7From) buckets.push(e.last7);
      else if (at >= prev28From && at < last7From) buckets.push(e.prev28);
    }
    if (buckets.length === 0) continue;
    const { priced } = price(r);
    const real = priced.kind === "priced" ? { stake: priced.stake, profit: priced.profit } : null;
    const hit = r.result === "hit";
    let simPriced: { stake: number; profit: number } | null = null;
    if (r.byHand && r.simShadow) {
      const s = price({ ...r, placement: "sim", sent: false, sim: r.simShadow, betStake: null, betProfit: null, betOdds: null, takenOdds: null, sentStake: null }).priced;
      simPriced = s.kind === "priced" ? { stake: s.stake, profit: s.profit } : null;
    }
    for (const b of buckets) {
      add(b.all, hit, real);
      if (r.byHand) {
        if (r.simShadow) add(b.sim, hit, simPriced);
      } else if (isLivePlacement(r.placement)) add(b.live, hit, real);
      else if (r.placement === "sim") add(b.sim, hit, real);
    }
  }
  return { weeks, strategies: out };
}
