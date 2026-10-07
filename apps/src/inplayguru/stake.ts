/**
 * Stakes as a percentage of the Betfair balance.
 *
 * A strategy's stake is either a flat amount in pounds (SendingSettings.stakes) or a percentage of the account's
 * balance (SendingSettings.stakePct). The percentage is turned into pounds at the moment a bet is built, and the
 * pound figure is what is saved with the bet (the feed row, the simulation row, the direct-betting record), so past
 * bets, profit and stop losses never change when the balance does.
 *
 * "Balance" = what is available to bet plus what is tied up in open bets, so a stake doesn't shrink just because
 * other bets are running. It is read from Betfair every couple of minutes (betfair/direct.ts) and kept here.
 *
 * Rules:
 *  - Live needs a balance read within the last 30 minutes. If Betfair can't be read, no percentage bet is placed
 *    (never a guess).
 *  - Simulation uses the last balance read, however old, so it keeps working through a short outage.
 *  - The result is rounded to the penny, held to the highest-stake safety limit (capped, not refused), and must be at
 *    least Betfair's smallest bet (£1), or the bet is skipped with the reason.
 */
import type { EngineDb } from "../storage/engine-db";
import type { SendingSettings } from "./bet-feed";

const BANK_KEY = "betfair_bank";
export const BANK_FRESH_MS = 30 * 60_000;
/** Betfair's smallest bet. */
export const MIN_BET = 1;
export const MIN_PCT = 0.1;
export const MAX_PCT = 25;

export interface Bank {
  /** Available to bet + tied up in open bets. */
  total: number | null;
  available: number | null;
  exposure: number | null;
  /** When Betfair was last read (ISO). */
  at: string | null;
}

export function getBank(db: EngineDb): Bank {
  try {
    const raw = db.getSetting(BANK_KEY);
    if (raw) {
      const b = JSON.parse(raw) as Partial<Bank>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      return { total: num(b.total), available: num(b.available), exposure: num(b.exposure), at: typeof b.at === "string" ? b.at : null };
    }
  } catch {
    // unreadable: as if never read
  }
  return { total: null, available: null, exposure: null, at: null };
}

export function saveBank(db: EngineDb, funds: { available: number | null; exposure: number | null }, now = new Date()): void {
  if (funds.available === null) return;
  const exposure = funds.exposure === null ? 0 : Math.abs(funds.exposure);
  const total = Math.round((funds.available + exposure) * 100) / 100;
  db.setSetting(BANK_KEY, JSON.stringify({ total, available: funds.available, exposure: funds.exposure, at: now.toISOString() }));
}

export function cleanPct(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= MIN_PCT && n <= MAX_PCT ? Math.round(n * 100) / 100 : null;
}

export interface StakeAnswer {
  /** Pounds for this bet, or null when there isn't one (see reason). */
  stake: number | null;
  /** The percentage when this strategy stakes by percentage. */
  pct: number | null;
  /** The percentage worked out above the highest-stake limit, so the limit was used. */
  capped: boolean;
  reason: string | null;
}

/** The stake in pounds for a strategy right now. `live` = a real bet (needs a fresh balance). */
export function resolveStake(settings: SendingSettings, key: string, bank: Bank, opts: { now: Date; live: boolean }): StakeAnswer {
  const pct = settings.stakePct[key];
  if (pct === undefined) {
    const flat = settings.stakes[key];
    return { stake: flat === undefined ? null : flat, pct: null, capped: false, reason: flat === undefined ? "No stake set for this strategy." : null };
  }
  const none = (reason: string): StakeAnswer => ({ stake: null, pct, capped: false, reason });
  if (bank.total === null || bank.at === null) return none("The Betfair balance isn't known yet, so a percentage stake can't be worked out.");
  if (opts.live && opts.now.getTime() - Date.parse(bank.at) > BANK_FRESH_MS) return none("The Betfair balance is out of date (not read for over 30 minutes), so no percentage bet is placed.");
  const raw = Math.round(((bank.total * pct) / 100) * 100) / 100;
  if (raw < MIN_BET) return none(`${pct}% of £${bank.total.toFixed(2)} is £${raw.toFixed(2)}, below Betfair's smallest bet (£${MIN_BET.toFixed(2)}).`);
  const capped = raw > settings.maxStake;
  return { stake: capped ? settings.maxStake : raw, pct, capped, reason: null };
}

/** For prices and reports that need "the stake this strategy would use now" (balance of any age). */
export function currentStake(db: EngineDb, settings: SendingSettings, key: string, now = new Date()): number | null {
  return resolveStake(settings, key, getBank(db), { now, live: false }).stake;
}
