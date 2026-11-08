/**
 * How each strategy does in each league (owner, 8 Nov 2026: "some leagues will perform better than others; build that
 * into the strategies and slices, so we get alerts only on performing Golden slices in green leagues").
 *
 * A strategy-in-a-league is judged on its priced picks there (Live and Sim together, from its rule change), as one of:
 *   proven  50+ priced picks and the whole likely range (about 95%) above zero
 *   green   30+ priced picks and still in profit after allowing for luck (the return shrunk towards zero, as the
 *           strategy suggestions do: roi x n / (n + 50)), by at least 2% per £1
 *   red     30+ priced picks and losing after the same allowance by 2% or more, or the whole range below zero
 *   grey    anything else: too few picks to say
 * With dozens of leagues per strategy, a few will look green by luck alone; the backtest (server/league-form.ts) shows
 * whether picking by league has actually paid, judging each pick only on what was known before it.
 *
 * Worked out hourly by server/league-form.ts and stored, so the bet feed and the notifications read it without working
 * anything out. Kept free of other imports so the bet feed can read it without a circular import.
 */
import type { EngineDb } from "../storage/engine-db";

export type LeagueLevel = "proven" | "green" | "grey" | "red";

/** What a strategy (or a slice) may bet in: every league, every league but the red ones, or green (and proven) only. */
export type LeagueFilter = "off" | "notRed" | "greenOnly";

export interface LeagueForm {
  level: LeagueLevel;
  /** Priced picks, the return per £1, and the likely range (null with too few). */
  n: number;
  roi: number | null;
  low: number | null;
  high: number | null;
}

export interface StoredLeagueForm {
  at: string;
  /** Strategy key -> league key -> form. */
  strategies: Record<string, Record<string, LeagueForm>>;
  /** League key -> its name and country, for showing. */
  names: Record<string, { league: string; country: string | null }>;
}

export const GREEN_FROM = 30;
export const PROVEN_FROM = 50;
const SHRINK = 50;
const MARGIN = 0.02;

/** The level for a tally of priced returns per £1: count, sum, sum of squares, and £ staked and profit. */
export function levelOf(t: { counted: number; staked: number; profit: number; sumR: number; sumR2: number }): LeagueForm {
  if (t.counted === 0 || t.staked <= 0) return { level: "grey", n: t.counted, roi: null, low: null, high: null };
  const roi = t.profit / t.staked;
  let low: number | null = null;
  let high: number | null = null;
  if (t.counted >= 2) {
    const mean = t.sumR / t.counted;
    const variance = Math.max(0, (t.sumR2 - t.counted * mean * mean) / (t.counted - 1));
    const half = 1.96 * Math.sqrt(variance / t.counted);
    low = roi - half;
    high = roi + half;
  }
  const adjusted = (roi * t.counted) / (t.counted + SHRINK);
  let level: LeagueLevel = "grey";
  if (t.counted >= PROVEN_FROM && low !== null && low > 0) level = "proven";
  else if (t.counted >= PROVEN_FROM && high !== null && high < 0) level = "red";
  else if (t.counted >= GREEN_FROM && adjusted >= MARGIN) level = "green";
  else if (t.counted >= GREEN_FROM && adjusted <= -MARGIN) level = "red";
  return { level, n: t.counted, roi, low, high };
}

/** Whether a level passes a filter. Grey passes "notRed" (no evidence against it) but not "greenOnly". */
export function passesLeagueFilter(filter: LeagueFilter | undefined, level: LeagueLevel | null): boolean {
  if (!filter || filter === "off") return true;
  if (filter === "notRed") return level !== "red";
  return level === "green" || level === "proven";
}

const KEY = "league_form";

export function getStoredLeagueForm(db: EngineDb): StoredLeagueForm | null {
  try {
    const raw = db.getSetting(KEY);
    return raw ? (JSON.parse(raw) as StoredLeagueForm) : null;
  } catch {
    return null;
  }
}

export function saveStoredLeagueForm(db: EngineDb, form: StoredLeagueForm): void {
  db.setSetting(KEY, JSON.stringify(form));
}

/** A strategy's level in a league, from the stored form (null when nothing is stored or it has never played there). */
export function leagueLevel(form: StoredLeagueForm | null, strategyKey: string, leagueKey: string): LeagueForm | null {
  return form?.strategies[strategyKey.toLowerCase()]?.[leagueKey] ?? null;
}
