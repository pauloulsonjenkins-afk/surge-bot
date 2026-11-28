import type { AdminStrategy, GoldenSlice, StrategyReturn } from "@/server/engine-client";

/**
 * The Strategies overview needs a few numbers per strategy, but the full strategies and Golden reports run to about
 * 1.4 MB (every strategy's form, segments and before/after splits; every Golden slice). These trims are applied on the
 * server, so the overview downloads, parses and keeps a few KB instead.
 */
export type Money = Pick<StrategyReturn, "counted" | "profit" | "staked">;

export interface StrategySummary {
  label: string;
  market: string | null;
  mode: "live" | "sim";
  mergedInto: string | null;
  sendingOn: boolean;
  lastAlertAt: string;
  returns: { live: Money; sim: Money; all?: Money } | null;
}

/** A Golden slice betting real money on its own. `own` is its own real bets (or the slice's Live record before it had any). */
export interface LiveSlice {
  id: string;
  label: string;
  strategy: string;
  strategyKey: string;
  own: Money;
}

const money = (r: StrategyReturn): Money => ({ counted: r.counted, profit: r.profit, staked: r.staked });

export function summariseStrategy(s: AdminStrategy): StrategySummary {
  const r = s.returns;
  return {
    label: s.label,
    market: s.market,
    mode: s.mode,
    mergedInto: s.mergedInto,
    sendingOn: s.sendingOn,
    lastAlertAt: s.lastAlertAt,
    returns: r ? { live: money(r.live), sim: money(r.sim), ...(r.all ? { all: money(r.all) } : {}) } : null,
  };
}

export function liveSlices(slices: GoldenSlice[]): LiveSlice[] {
  return slices
    .filter((s) => s.bet?.live)
    .map((s) => ({
      id: s.id,
      label: s.label,
      strategy: s.strategy,
      strategyKey: s.strategyKey,
      own: s.ownLive ? { counted: s.ownLive.n, profit: s.ownLive.profit, staked: s.ownLive.staked } : money(s.slice.live),
    }));
}
