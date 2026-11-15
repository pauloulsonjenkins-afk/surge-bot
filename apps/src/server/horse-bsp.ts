/**
 * HORSE TIP RESULTS (added 15 Nov 2026): what became of every tipped horse, whether or not a bet was taken.
 *
 * Betfair publishes each day's Betfair Starting Prices as free CSV files, UK and Irish, win and place:
 *   https://promo.betfair.com/betfairsp/prices/dwbfpricesukwin{DDMMYYYY}.csv   (also ...ukplace, ...irewin, ...ireplace)
 * Each row is one runner: its race, its name, win_lose (1 = won that market, 0 = lost) and its starting price (bsp).
 * Once a day's racing is over this finds each tip of that day in the files, and keeps won/lost, the win BSP and, for
 * each-way tips, whether it placed and the place BSP (horse_tip_results). Nothing here places or changes a bet.
 *
 * The record is a level-stakes one: 1 point to win, or 1 each way (2 points), at the starting price with Betfair's 2%
 * commission on winnings: tipPoints() below. This is the tip's own track record, not what the owner's bets returned.
 * The files give no jockey, trainer, going or form: a fuller API can sit beside this later (see ops notes).
 */
import type { EngineDb } from "../storage/engine-db";
import { ukDateOf } from "./uk-time";
import { log } from "./log";

const BASE = "https://promo.betfair.com/betfairsp/prices/";
/** Betfair's commission on winnings, for the level-stakes record. */
export const COMMISSION = 0.02;
/** Days back that are still tried. */
const DAYS_BACK = 14;

export interface BspRow {
  /** "Newmarket 31st Oct" */
  menu: string;
  /** "31-10-2026 15:23" (UK time) */
  at: string;
  race: string;
  horse: string;
  won: boolean;
  bsp: number | null;
}

/** One CSV line into fields (the files quote names that contain commas). */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The runners in one BSP file. A file without the expected columns gives none. */
export function parseBsp(csv: string): BspRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = fields(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const [iMenu, iAt, iRace, iHorse, iWin, iBsp] = ["menu_hint", "event_dt", "event_name", "selection_name", "win_lose", "bsp"].map(col);
  if ([iMenu, iAt, iRace, iHorse, iWin, iBsp].some((i) => i === undefined || i < 0)) return [];
  const rows: BspRow[] = [];
  for (const line of lines.slice(1)) {
    const f = fields(line);
    const bsp = Number(f[iBsp!]);
    rows.push({ menu: (f[iMenu!] ?? "").trim(), at: (f[iAt!] ?? "").trim(), race: (f[iRace!] ?? "").trim(), horse: (f[iHorse!] ?? "").trim(), won: f[iWin!]?.trim() === "1", bsp: Number.isFinite(bsp) && bsp > 1 ? bsp : null });
  }
  return rows;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/[^a-z0-9]/g, "");

/** "14:30" or "2:30" (as tipped, afternoon times may be 12-hour) against "31-10-2026 14:30". */
function sameTime(raceTime: string | null, at: string): boolean | null {
  const m = raceTime?.match(/(\d{1,2})[:.](\d{2})/);
  const t = at.match(/(\d{1,2}):(\d{2})$/);
  if (!m || !t) return null;
  const h = Number(m[1]);
  const hours = [h, h + 12].map((x) => x % 24);
  return hours.includes(Number(t[1])) && m[2] === t[2];
}

/** The runner a tip is, among a day's rows: by name, then the course and race time to tell two of one name apart. */
export function findRunner(rows: BspRow[], tip: { horse: string; course: string | null; raceTime: string | null }): BspRow | null {
  const same = rows.filter((r) => norm(r.horse) === norm(tip.horse));
  if (same.length <= 1) return same[0] ?? null;
  const byCourse = tip.course ? same.filter((r) => norm(r.menu).startsWith(norm(tip.course!))) : same;
  const pool = byCourse.length > 0 ? byCourse : same;
  const byTime = pool.filter((r) => sameTime(tip.raceTime, r.at) === true);
  return (byTime.length > 0 ? byTime : pool)[0] ?? null;
}

/** Points returned on a tip at level stakes: 1 to win, or 1 each way (2 points staked). Null when it can't be worked out. */
export function tipPoints(r: { betType: "win" | "ew"; result: "won" | "lost" | "not found"; bsp: number | null; placed: boolean | null; placeBsp: number | null }): { staked: number; profit: number } | null {
  if (r.result === "not found" || r.bsp === null) return null;
  const leg = (won: boolean, price: number) => (won ? (price - 1) * (1 - COMMISSION) : -1);
  if (r.betType === "win") return { staked: 1, profit: leg(r.result === "won", r.bsp) };
  if (r.placed === null || r.placeBsp === null) return null;
  return { staked: 2, profit: leg(r.result === "won", r.bsp) + leg(r.placed, r.placeBsp) };
}

/**
 * The file name's date. A file is named for the day AFTER its races (the file dated 12 Nov holds 11 Nov's races: checked
 * 15 Nov 2026 against the real files), because it is published the morning after.
 */
const ddmmyyyy = (day: string) => {
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return `${next.slice(8, 10)}${next.slice(5, 7)}${next.slice(0, 4)}`;
};

/** Fetches a file's text, or null when it isn't there (yet). */
export type FetchText = (url: string) => Promise<string | null>;

export async function fetchBspText(url: string): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  return res.ok ? await res.text() : null;
}

/**
 * One pass: every earlier day (up to two weeks back) with tips not yet found is read from Betfair's files.
 * A day whose win files aren't published yet is left for the next pass. Returns how many tips were recorded.
 */
export async function settleHorseTips(db: EngineDb, fetchText: FetchText = fetchBspText, now = new Date()): Promise<number> {
  const today = ukDateOf(now);
  // A tip not found is looked up again each pass (up to the two weeks): the files may not have been out, or a name may be
  // spelt differently in a later one. Found ones are done.
  const done = new Set(db.listHorseTipResults().filter((r) => r.result !== "not found").map((r) => `${r.day}|${r.rank}`));
  const oldest = new Date(now.getTime() - DAYS_BACK * 86_400_000).toISOString().slice(0, 10);
  const open = db.listHorseTipLog().filter((t) => t.day < today && t.day >= oldest && !done.has(`${t.day}|${t.rank}`));
  let recorded = 0;
  for (const day of [...new Set(open.map((t) => t.day))]) {
    const get = async (region: "uk" | "ire", kind: "win" | "place") => {
      const text = await fetchText(`${BASE}dwbfprices${region}${kind}${ddmmyyyy(day)}.csv`);
      return text === null ? null : parseBsp(text);
    };
    const [ukWin, ireWin, ukPlace, irePlace] = [await get("uk", "win"), await get("ire", "win"), await get("uk", "place"), await get("ire", "place")];
    // The win file of the UK is the one that is always there on a racing day; without it the day isn't published yet.
    if (ukWin === null) continue;
    const win = [...ukWin, ...(ireWin ?? [])];
    const place = [...(ukPlace ?? []), ...(irePlace ?? [])];
    for (const tip of open.filter((t) => t.day === day)) {
      const w = findRunner(win, tip);
      if (!w) {
        db.setHorseTipResult({ day, rank: tip.rank, result: "not found", bsp: null, placed: null, placeBsp: null, source: "Betfair BSP files" }, now);
        recorded++;
        continue;
      }
      const p = tip.betType === "ew" ? findRunner(place, tip) : null;
      db.setHorseTipResult({ day, rank: tip.rank, result: w.won ? "won" : "lost", bsp: w.bsp, placed: p ? p.won : null, placeBsp: p ? p.bsp : null, source: "Betfair BSP files" }, now);
      recorded++;
    }
  }
  if (recorded > 0) log.info(`Horse tips: ${recorded} tipped horse${recorded === 1 ? "" : "s"} looked up in Betfair's starting-price files.`);
  return recorded;
}

/** The stored results with each tip's level-stakes points (staked and profit), for the Horses log. */
export function horseTipResultsWithPoints(db: EngineDb) {
  const tips = new Map(db.listHorseTipLog().map((t) => [`${t.day}|${t.rank}`, t]));
  return db.listHorseTipResults().map((r) => {
    const tip = tips.get(`${r.day}|${r.rank}`);
    return { ...r, points: tip ? tipPoints({ betType: tip.betType, ...r }) : null };
  });
}