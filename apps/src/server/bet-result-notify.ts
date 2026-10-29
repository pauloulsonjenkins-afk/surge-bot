/**
 * A push notification when a bet with real money on it settles (29 Oct 2026, the owner's request): a bet GoalBrew placed
 * on Betfair, or one logged by hand on the Live tab ("Placed it yourself?"), or a Sim pick bet by hand. "Won +£4.40 ·
 * Wake-up Call · Mossoro v Visao Celeste", with the stake and the price it was taken at.
 *
 * The figure is the same one the Trade Log shows for the bet (winloss.ts's own pricing: real matched stake and Betfair
 * profit when there is one, else the stake and price logged by hand, after commission), so the two always agree.
 *
 * - Each bet is told once, when its result first arrives. A result later changed by hand (Fix a result) is told again,
 *   as a correction.
 * - The first pass only notes what has already settled, so switching this on sends nothing old.
 * - Quiet hours, 23:00 to 07:00 UK, hold them back (nothing is marked done): they come with the first pass after 07:00,
 *   as one summary when there are more than a few.
 * - A busy day (more than BUSY_AFTER bets told, or waiting, within an hour - a Saturday) switches to HOURLY: results are
 *   held and sent as one summary at most once an hour, with today's running total, instead of a buzz per bet.
 * - Information only. Nothing here changes a bet or a setting.
 */
import type { EngineDb } from "../storage/engine-db";
import { displayName } from "../inplayguru/strategy-names";
import { pricingInputs } from "./winloss";
import { isQuietHour } from "./golden-notify";
import { accountToday } from "../inplayguru/stop-loss";
import { sendPush } from "./push";
import { log } from "./log";

const STATE_KEY = "bet_result_notified";
/** Results are looked for this far back: a pick settles hours after it was seen, but not days. */
const WINDOW_MS = 72 * 3_600_000;
/** More new results than this in one pass come as one summary rather than one notification each. */
const MAX_SEPARATE = 3;
/** More bets than this told or waiting within an hour makes it a busy day: from then on, one summary an hour. */
const BUSY_AFTER = 3;
const HOUR_MS = 3_600_000;
/** How many bets are remembered as told. */
const KEEP = 600;

type Told = Record<string, "hit" | "miss">;
interface State {
  done: Told;
  /** When each of the recent notifications went out (ISO), to tell a busy hour from a quiet one. */
  sent: string[];
  /** When the last hourly summary went out. */
  digestAt: string | null;
}
/** Per database: the results version last read, and whether results are being held for the hour's summary (look again even though nothing new has settled). */
const watch = new WeakMap<EngineDb, { version: number; holding: boolean }>();

const money = (n: number) => `${n >= 0 ? "+" : "−"}£${Math.abs(n).toFixed(2)}`;

function loadState(db: EngineDb): State | null {
  try {
    const raw = db.getSetting(STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<State>;
    return { done: s.done ?? {}, sent: s.sent ?? [], digestAt: s.digestAt ?? null };
  } catch {
    return null;
  }
}

function saveState(db: EngineDb, s: State): void {
  const ids = Object.keys(s.done).sort((a, b) => Number(b) - Number(a)).slice(0, KEEP);
  db.setSetting(STATE_KEY, JSON.stringify({ done: Object.fromEntries(ids.map((id) => [id, s.done[id]!])), sent: s.sent.slice(-30), digestAt: s.digestAt }));
}

interface Settled {
  id: number;
  result: "hit" | "miss";
  profit: number;
  stake: number;
  odds: number;
  strategy: string;
  byHand: boolean;
}

/** Settled bets with real money on them, in the window: a Betfair bet, one logged by hand, or a Sim pick bet by hand. */
function settledBets(db: EngineDb, now: Date): Settled[] {
  const { price } = pricingInputs(db);
  const out: Settled[] = [];
  for (const r of db.listResultsForWinLoss(new Date(now.getTime() - WINDOW_MS).toISOString())) {
    if (!(r.placement === "betfair" || r.placement === "manual" || r.byHand)) continue;
    const { priced } = price(r);
    if (priced.kind !== "priced") continue;
    out.push({ id: r.id, result: r.result, profit: priced.profit, stake: priced.stake, odds: priced.odds, strategy: r.strategy, byHand: r.placement === "manual" || r.byHand });
  }
  return out;
}

/** The notifications for the bets that settled (or changed) since the last pass. Returns how many were sent. */
export async function notifyBetResults(db: EngineDb, now = new Date()): Promise<number> {
  // Nothing new settled since the last pass, and nothing held for the hour: nothing to read (the version moves on any result written).
  const version = db.resultsVersion();
  const w = watch.get(db) ?? { version: -1, holding: false };
  watch.set(db, w);
  if (version === w.version && !w.holding) return 0;
  const state = loadState(db);
  const bets = settledBets(db, now);
  if (state === null) {
    // First pass ever: remember what's already settled, tell none of it.
    saveState(db, { done: Object.fromEntries(bets.map((b) => [String(b.id), b.result])), sent: [], digestAt: null });
    w.version = version;
    return 0;
  }
  if (isQuietHour(now)) return 0;
  const told = state.done;
  const fresh = bets.filter((b) => told[String(b.id)] !== b.result);
  if (fresh.length === 0) {
    w.version = version;
    w.holding = false;
    return 0;
  }
  const recent = state.sent.filter((t) => now.getTime() - Date.parse(t) < HOUR_MS).length;
  // Results already held for the hour go out as the summary even if the hour itself has since quietened.
  const busy = recent + fresh.length > BUSY_AFTER || w.holding;
  // An hour since the last notification of any kind: so the first busy result waits, rather than going out on its own.
  const last = state.sent.at(-1);
  const digestDue = last === undefined || now.getTime() - Date.parse(last) >= HOUR_MS;
  // A busy hour: held (not marked done) until an hour has passed since the last summary, then all sent as one.
  if (busy && !digestDue) {
    w.holding = true;
    return 0;
  }
  w.version = version;
  w.holding = false;

  // A bet already told with the other result has been corrected (Fix a result): said so, not told as new.
  const corrected = new Set(fresh.filter((b) => told[String(b.id)] !== undefined).map((b) => b.id));
  for (const b of fresh) told[String(b.id)] = b.result;
  state.sent.push(now.toISOString());
  if (busy || fresh.length > MAX_SEPARATE) state.digestAt = now.toISOString();
  // Marked first, so a slow or failed push never sends it twice.
  saveState(db, state);

  if (busy || fresh.length > MAX_SEPARATE) {
    const won = fresh.filter((b) => b.profit > 0).length;
    const total = fresh.reduce((t, b) => t + b.profit, 0);
    const today = accountToday(db, now, "live").net;
    await sendPush(db, {
      title: `${fresh.length} bet${fresh.length === 1 ? "" : "s"} settled: ${money(total)}`,
      body: `${won} won, ${fresh.length - won} lost. Today so far ${money(today)}. ${fresh.map((b) => `${displayName(db, b.strategy)} ${money(b.profit)}`).join(" · ")}`.slice(0, 220),
      url: "/trade-log",
      tag: "bet-results",
    });
    return 1;
  }
  for (const b of fresh) {
    const pick = db.getLivePick(b.id);
    const teams = pick?.home && pick?.away ? `${pick.home} v ${pick.away}` : "";
    await sendPush(db, {
      title: `${corrected.has(b.id) ? "Result changed: " : ""}${b.profit > 0 ? "Won" : "Lost"} ${money(b.profit)}`,
      body: [displayName(db, b.strategy), teams, `£${b.stake.toFixed(2)} at ${b.odds.toFixed(2)}${b.byHand ? " (placed by hand)" : ""}`].filter(Boolean).join(" · "),
      url: "/trade-log",
      tag: `bet-result-${b.id}${corrected.has(b.id) ? "-fixed" : ""}`,
    });
  }
  log.info(`Bet results: ${fresh.length} settled bet(s) notified.`);
  return fresh.length;
}
