/**
 * Horses: a daily record of four racing bets (NAP, Next best, 3rd and 4th choice), entered by hand on the admin Horses
 * page, each marked won, lost or void once the race is run. Nothing here is automatic and nothing is sent anywhere.
 *
 * Money (the stake is per part, so "£5 each-way" costs £10):
 *   win bet       won: stake x odds back; lost: nothing back; void (non-runner): stake back
 *   each-way bet  two bets, win and place. Place odds = 1 + (odds - 1) / fraction (1/4 or 1/5 of the odds).
 *                 won: both pay; placed: the place part pays, the win part loses; lost: nothing back; void: both stakes back
 *   EW Yankee     optional, on a day's four selections: 11 bets (6 doubles, 4 trebles, a fourfold) each way = 22 bets at
 *                 the unit stake. It isn't marked: it settles from the four selections' results (src/lib/horses.ts).
 * Pending bets are counted as staked but not settled. The sums live in the website (src/lib/horses.ts).
 */
import type { EngineDb } from "../storage/engine-db";

export const HORSE_RANKS = [1, 2, 3, 4] as const;
export type HorseRank = (typeof HORSE_RANKS)[number];
export type HorseResult = "pending" | "won" | "placed" | "lost" | "void";
export type HorseBetType = "win" | "ew";

export interface HorseBet {
  id: number;
  /** UK date, YYYY-MM-DD. */
  day: string;
  /** 1 = NAP, 2 = Next best, 3 = 3rd choice, 4 = 4th choice. */
  rank: HorseRank;
  horse: string | null;
  /** Per part: an each-way bet's total cost is twice this. */
  stake: number;
  betType: HorseBetType;
  /** The place part pays 1/this of the odds (4 = 1/4, 5 = 1/5). Set for each-way bets, and for every selection on a day
   * with an EW Yankee (its place part needs them); otherwise null. */
  ewFraction: number | null;
  /** Each-way only, for the record: how many places pay. */
  ewPlaces: number | null;
  /** Decimal odds (5/2 is 3.5). */
  odds: number;
  /** The odds as typed, e.g. "5/2" or "evens". */
  oddsText: string;
  result: HorseResult;
}

/** A day's extra bets on its selections: the EW Yankee's unit stake (it costs 22 times this), or null for none. */
export interface HorseDay {
  day: string;
  yankeeStake: number | null;
}

export interface HorseEntry {
  rank: HorseRank;
  horse?: string | null;
  stake: number | string;
  odds: number | string;
  betType?: HorseBetType;
  ewFraction?: number | string | null;
  ewPlaces?: number | string | null;
}

/**
 * Decimal odds from what's typed: fractional ("5/2", "100/30", "11-10"), "evens" / "evs", or decimal ("3.5").
 * Null when it isn't a price between 1.01 and 1001.
 */
export function parseOdds(v: unknown): number | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(evens|evs|even|ev)$/.test(s)) return 2;
  const frac = /^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/.exec(s);
  const n = frac ? 1 + Number(frac[1]) / Number(frac[2]) : Number(s);
  if (!Number.isFinite(n) || n < 1.01 || n > 1001) return null;
  return Math.round(n * 1000) / 1000;
}

function parseStake(v: unknown): number | null {
  const n = Number(String(v ?? "").trim().replace(/^£/, ""));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

export function listHorseBets(db: EngineDb): HorseBet[] {
  return db.listHorseBets();
}

export function listHorseDays(db: EngineDb): HorseDay[] {
  return db.listHorseDays();
}

/**
 * Saves one day's choices. A rank left blank (no stake and no odds) removes that day's bet for it; a filled rank must
 * have a valid stake and odds. An existing bet keeps its result unless its odds or stake change, when it is reset to
 * pending (a changed bet is a new bet). Throws a plain-English error for anything that can't be saved.
 */
export function saveHorseDay(db: EngineDb, day: unknown, entries: unknown, yankeeStake: unknown = null): HorseBet[] {
  if (!isDay(day)) throw new Error("Choose a date.");
  if (!Array.isArray(entries)) throw new Error("Nothing to save.");
  const yankee = yankeeStake === null || yankeeStake === undefined || yankeeStake === "" ? null : parseStake(yankeeStake);
  if (yankeeStake !== null && yankeeStake !== undefined && yankeeStake !== "" && yankee === null) throw new Error("EW Yankee: enter a unit stake, for example 1 or 0.50.");
  const label = (r: number) => ["NAP", "Next best", "3rd choice", "4th choice"][r - 1];
  const rows: Array<
    | { rank: HorseRank; horse: string | null; stake: number; odds: number; oddsText: string; betType: HorseBetType; ewFraction: number | null; ewPlaces: number | null }
    | { rank: HorseRank; remove: true }
  > = [];
  for (const raw of entries as Array<Partial<HorseEntry>>) {
    const rank = Number(raw?.rank) as HorseRank;
    if (!HORSE_RANKS.includes(rank)) continue;
    const stakeText = String(raw.stake ?? "").trim();
    const oddsText = String(raw.odds ?? "").trim();
    if (!stakeText && !oddsText) {
      rows.push({ rank, remove: true });
      continue;
    }
    const stake = parseStake(stakeText);
    const odds = parseOdds(oddsText);
    if (stake === null) throw new Error(`${label(rank)}: enter a bet amount, for example 5 or 2.50.`);
    if (odds === null) throw new Error(`${label(rank)}: enter the odds as a fraction (5/2), evens, or a decimal (3.5).`);
    const horse = typeof raw.horse === "string" && raw.horse.trim() ? raw.horse.trim().slice(0, 80) : null;
    const betType: HorseBetType = raw.betType === "ew" ? "ew" : "win";
    let ewFraction: number | null = null;
    let ewPlaces: number | null = null;
    // Place terms are needed for an each-way bet, and for every selection when the day has an EW Yankee.
    if (betType === "ew" || yankee !== null) {
      ewFraction = Number(raw.ewFraction);
      if (!Number.isInteger(ewFraction) || ewFraction < 2 || ewFraction > 6) throw new Error(`${label(rank)}: choose the each-way terms (1/4 or 1/5 of the odds).`);
      const places = raw.ewPlaces === null || raw.ewPlaces === undefined || raw.ewPlaces === "" ? null : Number(raw.ewPlaces);
      if (places !== null && (!Number.isInteger(places) || places < 1 || places > 10)) throw new Error(`${label(rank)}: the number of places should be 1 to 10.`);
      ewPlaces = places;
    }
    rows.push({ rank, horse, stake, odds, oddsText: oddsText.slice(0, 20), betType, ewFraction, ewPlaces });
  }
  if (yankee !== null && rows.filter((r) => !("remove" in r)).length !== 4) {
    throw new Error("An EW Yankee needs all four selections: fill in NAP, Next best, 3rd and 4th choice.");
  }
  db.saveHorseDay(day, rows, yankee);
  return db.listHorseBets().filter((b) => b.day === day);
}

export function setHorseResult(db: EngineDb, id: unknown, result: unknown): void {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error("No such bet.");
  if (result !== "pending" && result !== "won" && result !== "placed" && result !== "lost" && result !== "void") throw new Error("Choose won, placed, lost, void or pending.");
  if (!db.setHorseResult(n, result)) throw new Error("No such bet.");
}
