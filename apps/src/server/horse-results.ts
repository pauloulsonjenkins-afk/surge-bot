/**
 * Horses: each day's results logged from Betfair, so the Daily record fills itself in after the races.
 *
 * Betfair only lists OPEN markets, so this works in two steps, every 15 minutes from 08:00 to 23:00 UK:
 *   1. link    each pending bet (today or the last 3 days) with a horse is matched to the day's WIN market that has a
 *              runner of that name (at its course when the venue matches), and the PLACE market of the same race; the
 *              market and runner ids are kept.
 *   2. settle  once a linked WIN market has closed: REMOVED (non-runner) = void, WINNER = won; LOSER = placed for an
 *              each-way bet whose runner won the PLACE market, otherwise lost.
 * Only the result is set. The odds, stakes and anything else typed in are never changed, and a result marked by hand
 * is never overwritten (only "pending" bets are looked at).
 */
import type { EngineDb } from "../storage/engine-db";
import { listHorseBets, setHorseResult, type HorseBet } from "./horses";
import { addDaysUk } from "../members/time";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { log } from "./log";

const LINKS_KEY = "horse_market_links";

interface Link {
  winMarketId: string;
  placeMarketId: string | null;
  selectionId: number;
  placeSelectionId: number | null;
}

export interface HorseResultsReader {
  horseMarkets(fromIso: string, toIso: string): Promise<Array<{ marketId: string; marketType: string; venue: string | null; start: string | null; runners: Array<{ selectionId: number; runnerName: string }> }>>;
  runnerResult(marketId: string, selectionId: number): Promise<"WINNER" | "LOSER" | "REMOVED" | null>;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/[^a-z0-9]/g, "");

function links(db: EngineDb): Record<string, Link> {
  try {
    return JSON.parse(db.getSetting(LINKS_KEY) ?? "{}") as Record<string, Link>;
  } catch {
    return {};
  }
}

/** One pass: link new pending bets to their markets, then settle the ones whose race is over. Returns how many were set. */
export async function logHorseResults(db: EngineDb, reader: HorseResultsReader, now = new Date()): Promise<number> {
  const today = ukDateOf(now);
  const oldest = addDaysUk(today, -3);
  const pending = listHorseBets(db).filter((b) => b.result === "pending" && b.horse && b.day >= oldest && b.day <= today);
  if (pending.length === 0) return 0;
  const linked = links(db);

  // 1. Link today's unlinked bets (only today's markets are still open).
  const toLink = pending.filter((b) => !linked[String(b.id)] && b.day === today);
  if (toLink.length > 0) {
    const { from } = ukDayBounds(today);
    const to = ukDayBounds(today).to;
    const markets = await reader.horseMarkets(from, to);
    for (const b of toLink) {
      const name = norm(b.horse!);
      const course = b.course ? norm(b.course) : null;
      const wins = markets.filter((m) => m.marketType === "WIN" && m.runners.some((r) => norm(r.runnerName) === name));
      const win = wins.find((m) => course && m.venue && norm(m.venue) === course) ?? (wins.length === 1 ? wins[0] : undefined);
      if (!win) continue;
      const runner = win.runners.find((r) => norm(r.runnerName) === name)!;
      const place = markets.find((m) => m.marketType === "PLACE" && m.start === win.start && m.venue === win.venue && m.runners.some((r) => norm(r.runnerName) === name));
      linked[String(b.id)] = {
        winMarketId: win.marketId,
        placeMarketId: place?.marketId ?? null,
        selectionId: runner.selectionId,
        placeSelectionId: place?.runners.find((r) => norm(r.runnerName) === name)?.selectionId ?? null,
      };
    }
  }

  // 2. Settle the linked bets whose race is over.
  let set = 0;
  for (const b of pending) {
    const l = linked[String(b.id)];
    if (!l) continue;
    const win = await reader.runnerResult(l.winMarketId, l.selectionId);
    if (win === null) continue; // still running, or not settled yet
    let result: HorseBet["result"];
    if (win === "REMOVED") result = "void";
    else if (win === "WINNER") result = "won";
    else if (b.betType === "ew" && l.placeMarketId && l.placeSelectionId !== null) {
      const place = await reader.runnerResult(l.placeMarketId, l.placeSelectionId);
      if (place === null) continue;
      result = place === "WINNER" ? "placed" : "lost";
    } else result = "lost";
    setHorseResult(db, b.id, result);
    delete linked[String(b.id)];
    set++;
    log.info(`Horses: ${b.horse} (${b.day}) logged as ${result} from Betfair.`);
  }
  // Forget links for bets no longer pending (marked by hand) or too old.
  const keep = new Set(pending.map((b) => String(b.id)));
  for (const k of Object.keys(linked)) if (!keep.has(k)) delete linked[k];
  db.setSetting(LINKS_KEY, JSON.stringify(linked));
  return set;
}
