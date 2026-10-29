/**
 * Bets placed by hand against bets GoalBrew placed itself (29 Oct 2026, the owner's request): for each period, how many
 * bets, how many won, the £ staked and won or lost, the profit in units (flat 1-unit stake per bet), so the two can be
 * compared on the Profit page: is placing a bet by hand paying better or worse than leaving it to the automatic one?
 *
 * Only bets with real money on them, and the figure is the same one the Trade Log shows for each (winloss.ts's own
 * pricing: the real matched stake and Betfair profit when there is one, else the stake and price logged by hand, after
 * commission). Information only: nothing here changes a bet.
 *
 *   By hand    a bet logged on the Live tab ("Placed it yourself?"), and a Sim pick bet for real with its button there.
 *   Automatic  a bet GoalBrew placed on Betfair from an alert, with no hand in it.
 * Bets from before GoalBrew placed its own (the old betting software) are in neither.
 */
import type { EngineDb } from "../storage/engine-db";
import { pricingInputs } from "./winloss";
import { ukDateOf, ukDateOfIso } from "./uk-time";

export type Method = "auto" | "hand";

export interface MethodTotals {
  bets: number;
  won: number;
  /** £ staked (a LAY's liability), and £ won or lost after commission. */
  staked: number;
  profit: number;
  /** Profit at a flat 1-unit stake per bet. */
  units: number;
}

export type PeriodKey = "today" | "d7" | "d30" | "all";
export interface ByMethodReport {
  periods: Record<PeriodKey, Record<Method, MethodTotals>>;
}

/** How a pick was bet, or null when it isn't a real-money bet this compares. */
export function methodOf(placement: string, byHand: boolean): Method | null {
  if (placement === "manual" || byHand) return "hand";
  if (placement === "betfair") return "auto";
  return null;
}

const empty = (): MethodTotals => ({ bets: 0, won: 0, staked: 0, profit: 0, units: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeByMethod(db: EngineDb, now = new Date()): ByMethodReport {
  const { price } = pricingInputs(db);
  const today = ukDateOf(now);
  const from = {
    today,
    d7: ukDateOf(new Date(now.getTime() - 6 * 86_400_000)),
    d30: ukDateOf(new Date(now.getTime() - 29 * 86_400_000)),
  };
  const periods: ByMethodReport["periods"] = {
    today: { auto: empty(), hand: empty() },
    d7: { auto: empty(), hand: empty() },
    d30: { auto: empty(), hand: empty() },
    all: { auto: empty(), hand: empty() },
  };
  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")) {
    const method = methodOf(r.placement, r.byHand);
    if (!method) continue;
    const { priced } = price(r);
    if (priced.kind !== "priced" || !(priced.stake > 0)) continue;
    const day = ukDateOfIso(r.firstSeenAt);
    const into: PeriodKey[] = ["all"];
    if (day >= from.d30) into.push("d30");
    if (day >= from.d7) into.push("d7");
    if (day >= from.today) into.push("today");
    for (const p of into) {
      const t = periods[p][method];
      t.bets++;
      if (priced.profit > 0) t.won++;
      t.staked += priced.stake;
      t.profit += priced.profit;
      t.units += priced.profit / priced.stake;
    }
  }
  for (const p of Object.values(periods)) for (const t of Object.values(p)) {
    t.staked = r2(t.staked);
    t.profit = r2(t.profit);
    t.units = r2(t.units);
  }
  return { periods };
}
