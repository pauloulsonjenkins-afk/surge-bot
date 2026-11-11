/**
 * Guard on real-money settings (site review S1 and C4, 11 Nov 2026).
 *
 *   - A daily loss limit above 20% of the balance can never stop a bad day.
 *   - A stake above 5% of the balance is one bad run from ruin.
 *   - A stake above 2% on fewer than 150 Live bets, or above 3% on fewer than 300, is a big bet on thin evidence: at the
 *     prices bet here, 150 bets still carry a margin of about +-12 points on the return.
 *
 * None is refused outright: the owner may mean it. The request must carry `confirm` with the figure typed again, so a
 * slip, a double tap or a replayed request cannot do it. Only a change that RAISES risk is checked: saving a page that
 * repeats an old figure, or lowering one, never asks. moneyProblems is pure: the patch, the settings as they are and
 * the figures in, the problems out.
 */
import type { EngineDb } from "../storage/engine-db";
import { isLivePlacement } from "../storage/engine-db";
import { strategyLabel, type SendingSettings } from "../inplayguru/bet-feed";
import { liveSinceRecord } from "./golden";

export const MAX_LOSS_LIMIT_PCT = 20;
export const MAX_STAKE_PCT = 5;
/** Stake caps by evidence: [fewer Live bets than, the most % of the balance]. */
export const EVIDENCE_CAPS: Array<[number, number]> = [
  [150, 2],
  [300, 3],
];

export interface MoneyProblem {
  /** What is being set, in words. */
  what: string;
  /** The figure the owner must type again to confirm it. */
  figure: string;
  reason: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The most a stake may be without confirming, for this many settled Live bets (null = not known, so only the 5% applies). */
export function stakeCapFor(liveBets: number | null): number {
  if (liveBets === null) return MAX_STAKE_PCT;
  for (const [under, cap] of EVIDENCE_CAPS) if (liveBets < under) return cap;
  return MAX_STAKE_PCT;
}

export interface GuardInputs {
  /** The settings before the change. */
  current: Pick<SendingSettings, "dailyLossLimit" | "stakePct" | "stakes" | "segmentBets">;
  /** The Betfair balance (null while unknown: money figures can't be judged, percentages still are). */
  balance: number | null;
  /** Settled Live bets for a strategy key, or a "strategy#slice" key (its own Live bets). Null when it can't be counted. */
  liveBets: (key: string) => number | null;
}

/** Problems with the stakes and loss limit in a settings patch. */
export function moneyProblems(patch: Record<string, unknown>, g: GuardInputs): MoneyProblem[] {
  const out: MoneyProblem[] = [];
  const { balance } = g;
  const loss = num(patch.dailyLossLimit);
  if (loss !== null && loss > 0 && loss !== g.current.dailyLossLimit && balance !== null && balance > 0 && loss > (balance * MAX_LOSS_LIMIT_PCT) / 100) {
    out.push({
      what: "Daily loss limit",
      figure: String(loss),
      reason: `A daily loss limit of £${loss} is ${Math.round((100 * loss) / balance)}% of the £${balance.toFixed(2)} balance, so it could not stop a bad day. Up to ${MAX_LOSS_LIMIT_PCT}% (£${Math.floor((balance * MAX_LOSS_LIMIT_PCT) / 100)}) needs no confirming.`,
    });
  }

  // Each stake being set: what to call it, the new % of the balance, and the % it is now.
  const stakes: Array<{ key: string; what: string; pct: number; was: number | null }> = [];
  const asPct = (flat: number | null | undefined) => (flat != null && balance !== null && balance > 0 ? (100 * flat) / balance : null);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (patch.stakePct && typeof patch.stakePct === "object") {
    for (const [k, v] of Object.entries(patch.stakePct as Record<string, unknown>)) {
      const key = k.toLowerCase();
      const p = num(v);
      if (p !== null) stakes.push({ key, what: `Stake for "${k}"`, pct: p, was: g.current.stakePct[key] ?? asPct(g.current.stakes[key]) });
    }
  }
  if (patch.stakes && typeof patch.stakes === "object") {
    for (const [k, v] of Object.entries(patch.stakes as Record<string, unknown>)) {
      const key = k.toLowerCase();
      const p = asPct(num(v));
      if (p !== null) stakes.push({ key, what: `Stake for "${k}" (£${num(v)})`, pct: round1(p), was: g.current.stakePct[key] ?? asPct(g.current.stakes[key]) });
    }
  }
  if (patch.segmentBets && typeof patch.segmentBets === "object") {
    for (const [k, v] of Object.entries(patch.segmentBets as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const key = k.toLowerCase();
      const b = v as Record<string, unknown>;
      const cur = g.current.segmentBets[key];
      const p = num(b.stakePct) ?? asPct(num(b.stake));
      if (p !== null) stakes.push({ key, what: `Stake for the slice "${k}"`, pct: round1(p), was: cur ? (cur.stakePct ?? asPct(cur.stake)) : null });
    }
  }
  for (const s of stakes) {
    // Not a raise: the same figure saved again, or a cut.
    if (s.was !== null && s.pct <= s.was + 1e-9) continue;
    const bets = g.liveBets(s.key);
    const cap = stakeCapFor(bets);
    if (s.pct <= cap + 1e-9) continue;
    const reason =
      s.pct > MAX_STAKE_PCT
        ? `${s.pct}% of the balance is above the ${MAX_STAKE_PCT}% most that needs no confirming.`
        : `${s.pct}% of the balance on ${bets} settled Live bet${bets === 1 ? "" : "s"}: up to ${cap}% needs no confirming until it has ${EVIDENCE_CAPS.find(([, c]) => c === cap)?.[0] ?? 300}.`;
    out.push({ what: s.what, figure: String(s.pct), reason });
  }
  return out;
}

/** The problems the request has not confirmed. `confirm` is a figure or a list of figures, as typed. */
export function unconfirmed(problems: MoneyProblem[], confirm: unknown): MoneyProblem[] {
  const typed = (Array.isArray(confirm) ? confirm : [confirm])
    .filter((c) => typeof c === "string" || typeof c === "number")
    .map((c) => String(c).trim().replace(/^£|%$/g, ""));
  return problems.filter((p) => !typed.includes(p.figure));
}

/** Counts settled Live bets per strategy (one pass over the kept results, only when first asked), and a slice's own. */
export function liveBetCounter(db: EngineDb, settings: SendingSettings): (key: string) => number | null {
  let byStrategy: Map<string, number> | null = null;
  return (key) => {
    try {
      const hash = key.indexOf("#");
      if (hash > 0) {
        const bet = settings.segmentBets[key];
        return bet?.live && bet.liveSince ? liveSinceRecord(db, key.slice(0, hash), key.slice(hash + 1), bet.liveSince).n : 0;
      }
      if (!byStrategy) {
        byStrategy = new Map();
        for (const r of db.listResultsForWinLoss("")) {
          if (!isLivePlacement(r.placement) || r.byHand) continue;
          const k = strategyLabel(r.strategy).toLowerCase();
          byStrategy.set(k, (byStrategy.get(k) ?? 0) + 1);
        }
      }
      return byStrategy.get(key) ?? 0;
    } catch {
      return null;
    }
  };
}
