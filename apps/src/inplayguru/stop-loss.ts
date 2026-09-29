/**
 * Stop loss, per strategy.
 *
 * Two optional limits for each strategy, both counted over the current UK day and
 * both only from picks that were actually handed to the betting software:
 *
 *   Daily loss (£)   stop when the strategy's net result today is down by this much
 *                    (wins count against losses).
 *   Losing run       stop after this many losing picks in a row today.
 *
 * When a limit is hit, NEW picks for that strategy are left out of the bet feed for
 * the rest of the UK day (the Sending page shows why). Rows already handed over stay
 * as they are. Limits reset at UK midnight. "Resume today" restarts the count from
 * now, for when you want to carry on after a stop.
 *
 * Money is worked out the same way as Win/Loss: a miss loses the stake; a hit wins
 * stake x (odds - 1) less commission, using the price printed in the alert. A hit with
 * no usable price is counted as £0 won, never guessed, so the stop can only come early.
 * It is an estimate from alert prices, not from bets your software actually matched, so
 * keep the loss caps in the betting software itself as the outer net.
 *
 * Only settled picks count: a bet still in play has no result yet.
 */
import type { EngineDb } from "../storage/engine-db";

export interface StopLossRule {
  /** Net loss today, in pounds, that stops the strategy. Null = no limit. */
  dailyLoss: number | null;
  /** Losing picks in a row today that stop the strategy. Null = no limit. */
  lossRun: number | null;
  /** ISO time of the last "Resume today"; only picks after it are counted. */
  resumedAt: string | null;
}

export interface StopLossStatus {
  key: string;
  dailyLoss: number | null;
  lossRun: number | null;
  resumedAt: string | null;
  /** Sent picks settled today (since any resume) that were counted. */
  settledToday: number;
  /** Net result today in pounds (negative = down). */
  todayNet: number;
  /** Losing picks in a row, most recent first, today. */
  todayRun: number;
  stopped: boolean;
  /** Plain-English reason, set when stopped. */
  reason: string | null;
}

const SETTINGS_KEY = "stop_loss";
const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

const r2 = (n: number) => Math.round(n * 100) / 100;

function cleanMoney(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0.01 && n <= 100000 ? r2(n) : null;
}

function cleanRun(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null;
}

function labelOf(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || raw;
}

export function getStopLossRules(db: EngineDb): Record<string, StopLossRule> {
  const out: Record<string, StopLossRule> = {};
  try {
    const saved = db.getSetting(SETTINGS_KEY);
    const parsed = saved ? (JSON.parse(saved) as Record<string, Partial<StopLossRule>>) : {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object") continue;
      const rule: StopLossRule = {
        dailyLoss: cleanMoney(v.dailyLoss),
        lossRun: cleanRun(v.lossRun),
        resumedAt: typeof v.resumedAt === "string" && Number.isFinite(Date.parse(v.resumedAt)) ? v.resumedAt : null,
      };
      if (rule.dailyLoss !== null || rule.lossRun !== null) out[k.toLowerCase()] = rule;
    }
  } catch {
    // Unreadable setting: no limits (the switch and stake gates still apply).
  }
  return out;
}

/**
 * Changes one strategy's limits. `dailyLoss` / `lossRun`: a value sets it, null clears it.
 * `resume: true` restarts today's count from now.
 */
export function saveStopLossRule(
  db: EngineDb,
  key: string,
  patch: { dailyLoss?: unknown; lossRun?: unknown; resume?: unknown },
  now = new Date(),
): StopLossRule | null {
  const k = key.trim().toLowerCase();
  const rules = getStopLossRules(db);
  const cur: StopLossRule = rules[k] ?? { dailyLoss: null, lossRun: null, resumedAt: null };
  const next: StopLossRule = { ...cur };
  if (patch.dailyLoss !== undefined) next.dailyLoss = patch.dailyLoss === null ? null : (cleanMoney(patch.dailyLoss) ?? cur.dailyLoss);
  if (patch.lossRun !== undefined) next.lossRun = patch.lossRun === null ? null : (cleanRun(patch.lossRun) ?? cur.lossRun);
  if (patch.resume === true) next.resumedAt = now.toISOString();

  if (next.dailyLoss === null && next.lossRun === null) delete rules[k];
  else rules[k] = next;
  db.setSetting(SETTINGS_KEY, JSON.stringify(rules));
  return rules[k] ?? null;
}

/** Forgets a strategy's limits (used when the strategy is deleted). */
export function forgetStopLoss(db: EngineDb, key: string): void {
  const rules = getStopLossRules(db);
  if (rules[key.trim().toLowerCase()]) {
    delete rules[key.trim().toLowerCase()];
    db.setSetting(SETTINGS_KEY, JSON.stringify(rules));
  }
}

function winLossInputs(db: EngineDb): { commission: number; assumedOdds: Record<string, number> } {
  // The same two Win/Loss settings, read directly so this file needn't import that one.
  let commission = 0;
  const assumedOdds: Record<string, number> = {};
  try {
    const saved = db.getSetting("winloss");
    const raw = saved ? (JSON.parse(saved) as { commission?: unknown; assumedOdds?: Record<string, unknown> }) : {};
    const c = Number(raw.commission);
    if (Number.isFinite(c) && c >= 0 && c <= 20) commission = c / 100;
    for (const [k, v] of Object.entries(raw.assumedOdds ?? {})) {
      const o = Number(v);
      if (Number.isFinite(o) && o >= 1.01 && o <= 1000) assumedOdds[k.toLowerCase()] = o;
    }
  } catch {
    // leave the defaults
  }
  return { commission, assumedOdds };
}

/**
 * Where every strategy with a limit stands right now. Strategies without a limit aren't included,
 * so an empty map means nothing can be stopped.
 */
export function computeStopLoss(db: EngineDb, now = new Date()): Map<string, StopLossStatus> {
  const rules = getStopLossRules(db);
  const out = new Map<string, StopLossStatus>();
  const keys = Object.keys(rules);
  if (keys.length === 0) return out;

  const today = ukDay.format(now);
  const { commission, assumedOdds } = winLossInputs(db);
  // A day of margin either side; the exact UK day is checked below.
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const picks = db.listResultsForWinLoss(since).filter((r) => r.sentStake !== null && ukDay.format(new Date(r.firstSeenAt)) === today);

  for (const key of keys) {
    const rule = rules[key]!;
    const resumedMs = rule.resumedAt ? Date.parse(rule.resumedAt) : null;
    let net = 0;
    let settled = 0;
    let run = 0;
    for (const r of picks) {
      if (labelOf(r.strategy).toLowerCase() !== key) continue;
      if (resumedMs !== null && Date.parse(r.firstSeenAt) < resumedMs) continue;
      const stake = r.sentStake!;
      let profit: number;
      if (r.result === "hit") {
        const alertOdds =
          r.market === "NEXT_GOAL" && r.targetLine !== null && r.overLine === r.targetLine && r.overOdds !== null && r.overOdds > 1 ? r.overOdds : null;
        const odds = alertOdds ?? assumedOdds[key] ?? null;
        profit = odds === null ? 0 : stake * (odds - 1) * (1 - commission);
        run = 0;
      } else {
        profit = -stake;
        run++;
      }
      net += profit;
      settled++;
    }
    net = r2(net);

    let reason: string | null = null;
    if (rule.dailyLoss !== null && net <= -rule.dailyLoss) {
      reason = `down £${Math.abs(net).toFixed(2)} today (limit £${rule.dailyLoss.toFixed(2)}).`;
    } else if (rule.lossRun !== null && run >= rule.lossRun) {
      reason = `${run} losing picks in a row today (limit ${rule.lossRun}).`;
    }
    out.set(key, {
      key,
      dailyLoss: rule.dailyLoss,
      lossRun: rule.lossRun,
      resumedAt: rule.resumedAt,
      settledToday: settled,
      todayNet: net,
      todayRun: run,
      stopped: reason !== null,
      reason,
    });
  }
  return out;
}
