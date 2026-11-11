/**
 * Guard on real-money settings (site review C4, 11 Nov 2026). A daily loss limit above 20% of the balance can never bind,
 * and a stake above 5% of it is one bad run from ruin. Neither is refused outright: the owner may mean it. The request must
 * carry `confirm` with the figure typed again, so a slip or a replayed request cannot do it. Pure: patch and balance in,
 * the problems out.
 */
export const MAX_LOSS_LIMIT_PCT = 20;
export const MAX_STAKE_PCT = 5;

export interface MoneyProblem {
  /** What is being set, in words. */
  what: string;
  /** The figure the owner must type again to confirm it. */
  figure: string;
  reason: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Problems with the stakes and loss limit in a settings patch, given the current balance (null when unknown). */
export function moneyProblems(patch: Record<string, unknown>, balance: number | null): MoneyProblem[] {
  const out: MoneyProblem[] = [];
  const loss = num(patch.dailyLossLimit);
  if (loss !== null && loss > 0 && balance !== null && balance > 0 && loss > (balance * MAX_LOSS_LIMIT_PCT) / 100) {
    out.push({
      what: "daily loss limit",
      figure: String(loss),
      reason: `A daily loss limit of £${loss} is ${Math.round((100 * loss) / balance)}% of the £${balance.toFixed(2)} balance, so it could never stop a bad day. The most allowed without confirming is ${MAX_LOSS_LIMIT_PCT}% (£${Math.floor((balance * MAX_LOSS_LIMIT_PCT) / 100)}).`,
    });
  }
  const pcts: Array<[string, unknown]> = [];
  const group = (name: string, v: unknown) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) pcts.push([`${name} "${k}"`, x]);
  };
  group("stake %", patch.stakePct);
  if (patch.segmentBets && typeof patch.segmentBets === "object") {
    for (const [k, v] of Object.entries(patch.segmentBets as Record<string, unknown>)) {
      if (v && typeof v === "object") pcts.push([`slice stake % "${k}"`, (v as Record<string, unknown>).stakePct]);
    }
  }
  for (const [what, v] of pcts) {
    const p = num(v);
    if (p !== null && p > MAX_STAKE_PCT) out.push({ what, figure: String(p), reason: `A stake of ${p}% of the balance is above the ${MAX_STAKE_PCT}% most that is allowed without confirming.` });
  }
  return out;
}

/** The problems the request has not confirmed. `confirm` is a figure or a list of figures, as typed. */
export function unconfirmed(problems: MoneyProblem[], confirm: unknown): MoneyProblem[] {
  const typed = (Array.isArray(confirm) ? confirm : [confirm]).filter((c) => typeof c === "string" || typeof c === "number").map(String);
  return problems.filter((p) => !typed.includes(p.figure));
}
