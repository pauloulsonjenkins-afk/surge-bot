/**
 * EDGE VALUE CHECK: the Betfair price of each Edge trend's bet, for fixtures kicking off in the next 24 hours.
 *
 * For every trend that points at a Betfair bet (goals over/under, both teams to score, a first-half goal, Match Odds,
 * Double Chance), it reads the current back price and works out the hit rate that price needs after 2% commission.
 * `edge` = the trend's CAUTIOUS hit rate (its strength: the low end of its likely range, given the sample) minus that
 * need. Positive = the history says it happens more often than the price assumes: a potential opportunity.
 *
 * READ ONLY: it uses the same read-only Betfair reader as the bet check (listEvents, listMarketCatalogue,
 * listMarketBook). Nothing here places or changes a bet. Runs every two hours, and straight after the cards are worked out.
 */
import type { EngineDb } from "../storage/engine-db";
import { getExchangeReader, judgeExchange, searchWord, type BetfairReader } from "../betfair/exchange";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { edgeCards, KEY, type EdgeBet, type EdgeCard } from "./edge";
import { log } from "../server/log";

const AHEAD_MS = 24 * 3_600_000;
const COMMISSION = 0.02;
/** At most this many fixtures, and this many trends per fixture, priced per run (keeps Betfair calls modest). */
const MAX_FIXTURES = 60;
const TRENDS_PER_FIXTURE = 4;
const RUN_EVERY_MS = 2 * 3_600_000;

/** The hit rate a back price needs to break even after commission. */
export function neededFor(price: number): number {
  return 1 / (1 + (price - 1) * (1 - COMMISSION));
}

/** The Betfair market code and selection for a trend's bet, with Betfair's own team names. */
export function betfairBet(bet: EdgeBet, home: string, away: string, dc: { market: string; home: string; away: string }): { marketType: string; selection: string } {
  const ou = (line: string) => (bet.pick === "over" ? `Over ${line} Goals` : `Under ${line} Goals`);
  switch (bet.market) {
    case "OU15":
      return { marketType: "OVER_UNDER_15", selection: ou("1.5") };
    case "OU25":
      return { marketType: "OVER_UNDER_25", selection: ou("2.5") };
    case "OU35":
      return { marketType: "OVER_UNDER_35", selection: ou("3.5") };
    case "HT05":
      return { marketType: "FIRST_HALF_GOALS_05", selection: ou("0.5") };
    case "BTTS":
      return { marketType: "BOTH_TEAMS_TO_SCORE", selection: bet.pick === "yes" ? "Yes" : "No" };
    case "MO":
      return { marketType: "MATCH_ODDS", selection: bet.pick === "home" ? home : away };
    case "DC": {
      const t = bet.pick === "homeDraw" ? dc.home : dc.away;
      return { marketType: dc.market, selection: t.replace(/\{home\}/g, home).replace(/\{away\}/g, away) };
    }
  }
}

const events = new Map<string, { id: string; name: string } | null>();

async function findEvent(reader: BetfairReader, c: EdgeCard): Promise<{ id: string; name: string } | null> {
  const k = KEY(c.fixture);
  if (events.has(k)) return events.get(k)!;
  const at = new Date(c.fixture.kickoff);
  const { home, away } = c.fixture;
  let judged = judgeExchange(home, away, await reader.searchEvents(searchWord(home), at));
  if (judged.result === "off") judged = judgeExchange(home, away, await reader.searchEvents(searchWord(away), at));
  const found = judged.result !== "off" && judged.eventId && judged.event ? { id: judged.eventId, name: judged.event } : null;
  events.set(k, found);
  return found;
}

/** Prices the next 24 hours' cards and saves them back. Returns how many trends got a price. */
export async function priceEdge(db: EngineDb, reader: BetfairReader, now = new Date()): Promise<number> {
  const settings = getSendingSettings(db);
  const dc = { market: settings.underdogMarketType, home: settings.underdogHomeSelection, away: settings.underdogAwaySelection };
  const all = edgeCards(db, now);
  const soon = all.filter((c) => Date.parse(c.fixture.kickoff) >= now.getTime() && Date.parse(c.fixture.kickoff) <= now.getTime() + AHEAD_MS).slice(0, MAX_FIXTURES);
  let priced = 0;
  for (const c of soon) {
    const withBet = c.trends.filter((t) => t.bet).slice(0, TRENDS_PER_FIXTURE);
    if (withBet.length === 0) continue;
    const ev = await findEvent(reader, c).catch(() => null);
    const at = new Date().toISOString();
    if (!ev) {
      for (const t of withBet) t.betfair = { price: null, needed: null, edge: null, at, note: "Match not found on Betfair" };
      continue;
    }
    const [bfHome, bfAway] = ev.name.split(/ v /i).map((s) => s.trim());
    for (const t of withBet) {
      const b = betfairBet(t.bet!, bfHome ?? c.fixture.home, bfAway ?? c.fixture.away, dc);
      const r = await reader.checkBet(ev.id, b.marketType, b.selection).catch(() => null);
      if (!r || r.price === null) {
        t.betfair = { price: null, needed: null, edge: null, at, note: r?.status === "noMarket" ? "No such market on Betfair" : "No price yet" };
        continue;
      }
      const needed = neededFor(r.price);
      t.betfair = { price: r.price, needed, edge: t.strength - needed, at };
      priced++;
    }
    // The headline is a separate copy of the top trend once saved: point it at the priced one.
    if (c.headline) c.headline = c.trends.find((t) => t.text === c.headline!.text) ?? c.headline;
  }
  if (soon.length > 0) {
    db.replaceEdgeCards(
      all.map((c) => ({ key: KEY(c.fixture), kickoff: c.fixture.kickoff, json: JSON.stringify(c) })),
      new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    );
  }
  log.info(`Edge: Betfair prices read for ${priced} trends across ${soon.length} fixtures in the next 24 hours.`);
  return priced;
}

let running = false;

/** Prices now (skipped while a run is going, or when the Betfair link isn't set up). */
export async function priceEdgeNow(db: EngineDb): Promise<void> {
  const reader = getExchangeReader();
  if (!reader || running) return;
  running = true;
  try {
    await priceEdge(db, reader);
  } catch (err) {
    log.warn(`Edge prices: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running = false;
  }
}

/** Every two hours. */
export function startEdgePrices(db: EngineDb): void {
  setInterval(() => void priceEdgeNow(db), RUN_EVERY_MS).unref?.();
}
