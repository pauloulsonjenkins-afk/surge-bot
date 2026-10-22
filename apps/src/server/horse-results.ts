/**
 * Horses: each day's results logged from Betfair, so the Daily record fills itself in after the races.
 *
 * Betfair only lists OPEN markets, so this works in two steps, run every few minutes from 10:00 to 23:00 UK (main.ts):
 *   1. link    each of today's pending bets with a horse is matched to the day's WIN market that has a runner of that
 *              name (at its course when the venue matches), and the PLACE market of the same race; the market and
 *              runner ids and the race's start time are kept. A name spelled a little differently by the tipster
 *              ("Buccaybay" for Buccabay) is matched only within that one race: the bet's course and the tip's race
 *              time, at most two letters out, and no other runner as close. A bet still not found gets one notification
 *              so its result can be marked by hand. Tried within minutes of a bet being added (at most every
 *              10 minutes while one isn't found), so it's linked before its race and its market closes.
 *   2. settle  from a few minutes after the race's start time, until its WIN market has closed: REMOVED (non-runner) =
 *              void, WINNER = won; LOSER = placed when its runner won the PLACE market (each-way or win: a win single still
 *              loses, but the day's EW Yankee counts the place), otherwise lost.
 * Only the result is set. The odds, stakes and anything else typed in are never changed, and a result marked by hand
 * is never overwritten (only "pending" bets are looked at).
 */
import type { EngineDb } from "../storage/engine-db";
import { listHorseBets, setHorseResult, type HorseBet } from "./horses";
import { addDaysUk } from "../members/time";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { log } from "./log";
import { sendPush } from "./push";

const LINKS_KEY = "horse_market_links";
/** Bets already notified as not found on Betfair, so it's said once. */
const NOT_FOUND_KEY = "horse_not_found_told";

interface Link {
  winMarketId: string;
  placeMarketId: string | null;
  selectionId: number;
  placeSelectionId: number | null;
  /** The race's start time (ISO), so its result is looked for just after; missing on links kept before 21 Oct 2026. */
  start?: string | null;
}

/** How long after the off a race's result is first looked for, then on every pass until Betfair has settled it. */
const AFTER_OFF_MS = 5 * 60_000;
/** While a bet's race isn't found, Betfair's race list is read again at most this often. */
const LINK_RETRY_MS = 10 * 60_000;
const lastLinkTry = new WeakMap<EngineDb, number>();

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

/** Letters to add, drop or change to turn one name into the other. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** "HH:MM" UK time of an ISO start. */
const ukClock = (iso: string | null) =>
  iso && Number.isFinite(Date.parse(iso))
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))
    : null;

type Market = Awaited<ReturnType<HorseResultsReader["horseMarkets"]>>[number];

/**
 * The WIN market and runner for a horse whose name the tipster spelled differently: only in the bet's race (its course,
 * and the tip's race time when known), the closest runner at most two letters out (one for a short name), and only
 * when no other runner there is as close.
 */
export function closeRunner(markets: Market[], horse: string, course: string | null, raceTime: string | null): { win: Market; runner: Market["runners"][number] } | null {
  if (!course) return null;
  const name = norm(horse);
  const races = markets.filter((m) => m.marketType === "WIN" && m.venue && norm(m.venue) === norm(course) && (!raceTime || ukClock(m.start) === raceTime));
  const max = name.length >= 6 ? 2 : 1;
  const scored = races.flatMap((win) => win.runners.map((runner) => ({ win, runner, d: editDistance(norm(runner.runnerName), name) }))).filter((x) => x.d <= max);
  if (scored.length === 0) return null;
  const best = Math.min(...scored.map((x) => x.d));
  const at = scored.filter((x) => x.d === best);
  return at.length === 1 ? { win: at[0]!.win, runner: at[0]!.runner } : null;
}

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
  if (toLink.length > 0 && now.getTime() - (lastLinkTry.get(db) ?? 0) >= LINK_RETRY_MS) {
    lastLinkTry.set(db, now.getTime());
    const { from } = ukDayBounds(today);
    const to = ukDayBounds(today).to;
    const markets = await reader.horseMarkets(from, to);
    const tips = db.listHorseTipLog().filter((t) => t.day === today);
    const told = new Set<string>(JSON.parse(db.getSetting(NOT_FOUND_KEY) ?? "[]") as string[]);
    for (const b of toLink) {
      const course = b.course ? norm(b.course) : null;
      const wins = markets.filter((m) => m.marketType === "WIN" && m.runners.some((r) => norm(r.runnerName) === norm(b.horse!)));
      let win = wins.find((m) => course && m.venue && norm(m.venue) === course) ?? (wins.length === 1 ? wins[0] : undefined);
      let runner = win?.runners.find((r) => norm(r.runnerName) === norm(b.horse!));
      if (!win || !runner) {
        const tip = tips.find((t) => norm(t.horse) === norm(b.horse!));
        const close = closeRunner(markets, b.horse!, b.course, tip?.raceTime ?? null);
        if (close) {
          win = close.win;
          runner = close.runner;
          log.info(`Horses: "${b.horse}" taken as Betfair's "${runner.runnerName}" (${win.venue} ${ukClock(win.start)}).`);
        }
      }
      if (!win || !runner) {
        // Said once: its race is listed while it's still to run, so after that its result has to be marked by hand.
        if (!told.has(String(b.id))) {
          told.add(String(b.id));
          db.setSetting(NOT_FOUND_KEY, JSON.stringify([...told].slice(-50)));
          void sendPush(db, {
            title: `Horse not found on Betfair: ${b.horse}`,
            body: `${b.horse}${b.course ? ` at ${b.course}` : ""} isn't in Betfair's races today, so its result won't fill in by itself. Check the spelling, or mark the result by hand.`,
            url: "/more/admin/horses",
            tag: `horse-not-found-${b.id}`,
          }).catch(() => {});
        }
        continue;
      }
      const name = norm(runner.runnerName);
      const place = markets.find((m) => m.marketType === "PLACE" && m.start === win!.start && m.venue === win!.venue && m.runners.some((r) => norm(r.runnerName) === name));
      linked[String(b.id)] = {
        winMarketId: win.marketId,
        placeMarketId: place?.marketId ?? null,
        selectionId: runner.selectionId,
        placeSelectionId: place?.runners.find((r) => norm(r.runnerName) === name)?.selectionId ?? null,
        start: win.start,
      };
    }
  }

  // 2. Settle the linked bets whose race is over.
  let set = 0;
  for (const b of pending) {
    const l = linked[String(b.id)];
    if (!l) continue;
    // Not before the race is off (and a few minutes run).
    const off = l.start ? Date.parse(l.start) : NaN;
    if (Number.isFinite(off) && now.getTime() < off + AFTER_OFF_MS) continue;
    const win = await reader.runnerResult(l.winMarketId, l.selectionId);
    if (win === null) continue; // still running, or not settled yet
    let result: HorseBet["result"];
    if (win === "REMOVED") result = "void";
    else if (win === "WINNER") result = "won";
    // Placed is checked for win bets too: the single still loses, but a Yankee's place part pays on it.
    else if (l.placeMarketId && l.placeSelectionId !== null) {
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
