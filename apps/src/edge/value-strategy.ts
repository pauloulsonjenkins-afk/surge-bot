/**
 * BEST VALUE CUPPA: Edge's Betfair value bets, recorded as a strategy of their own so they build a Sim record like
 * every other strategy (Strategies, Results, Win/Loss).
 *
 * The bet varies pick to pick: both teams to score yes/no, goals over/under (1.5, 2.5, 3.5) or a first-half goal,
 * whichever trend Betfair prices below its history (edge/edge-prices.ts). Result bets (a team to win, double chance)
 * were dropped on 18 Oct 2026: 8-16, about -40% per £1, while the goals bets were level or better. Edge still shows them.
 *
 *   picks   each time the prices are read, every value trend on a match kicking off within the next 3 hours: at least
 *           5 points of edge, on at least 10 games, at most two per match (best first) and never two that pull against
 *           each other (two result bets, or goals over with goals under). The same match and bet is only added once, at
 *           the price read then.
 *   stake   in Sim, the strategy's stake on Strategies, else £1, so the record reads per £1 until one is set.
 *   settled from Betfair's own result for that market once it closes (won / lost); a voided selection, or one Betfair
 *           still hasn't settled four days on, leaves the figures.
 *
 * LIVE: like any strategy, only when switched Live on Strategies (with a stake). Then each pick goes through the bet
 * feed's usual checks (stake, minimum odds, daily and match limits, stop loss) as its own market and selection, and is
 * bet up to kick-off. In Sim (the default) nothing is ever bet.
 */
import type { EngineDb } from "../storage/engine-db";
import type { BetfairReader } from "../betfair/exchange";
import type { ParsedAlert } from "../inplayguru/parse-alert";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { getBank, resolveStake } from "../inplayguru/stake";
import { getExchangeReader } from "../betfair/exchange";
import { KEY, type EdgeBet, type EdgeCard, type EdgeTrend } from "./edge";
import { log } from "../server/log";

export const STRATEGY = "Best Value Cuppa";
const KEY_NAME = STRATEGY.toLowerCase();
const WINDOW_MS = 3 * 3_600_000;
const PER_MATCH = 2;
/** The trend's cautious rate must beat the price's need by at least this much (5 points). */
const MIN_EDGE = 0.05;
/** And rest on at least this many games (a handful of head-to-head meetings isn't enough). */
const MIN_SAMPLE = 10;

/** Which way a bet leans, so one match never gets two bets that work against each other. */
function family(bet: EdgeBet): "result" | "goalsUp" | "goalsDown" {
  if (bet.market === "MO" || bet.market === "DC") return "result";
  return bet.pick === "over" || bet.pick === "yes" ? "goalsUp" : "goalsDown";
}
/** A match is over (and its markets settling) about this long after kick-off. */
const SETTLE_AFTER_MS = 2.5 * 3_600_000;
const GIVE_UP_MS = 4 * 24 * 3_600_000;
const SETTLE_EVERY_MS = 30 * 60_000;

/** What an Edge pick keeps beside the usual pick fields, for settling and for showing why it was picked. */
export interface EdgePickInfo {
  bet: EdgeBet;
  trend: string;
  kickoff: string;
  marketId: string;
  selectionId: number;
  /** Betfair's market code and selection name: what the bet feed sends when the strategy is Live. */
  marketType: string;
  selectionName: string;
  price: number;
  needed: number;
  edge: number;
}

/** A stable message id for one fixture and bet, so the same pick is never added twice. */
export function pickId(card: EdgeCard, bet: EdgeBet): number {
  const s = `${KEY(card.fixture)}|${bet.market}|${bet.pick}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}

/** The bet in words: "Over 2.5 goals", "Both teams to score: No", "Leeds to win", "Man Utd or draw", "1st half: Over 0.5 goals". */
export function betWords(bet: EdgeBet, home: string, away: string): string {
  const goals = (line: string) => `${bet.pick === "over" ? "Over" : "Under"} ${line} goals`;
  switch (bet.market) {
    case "OU15":
      return goals("1.5");
    case "OU25":
      return goals("2.5");
    case "OU35":
      return goals("3.5");
    case "HT05":
      return `1st half: ${goals("0.5")}`;
    case "BTTS":
      return `Both teams to score: ${bet.pick === "yes" ? "Yes" : "No"}`;
    case "MO":
      return `${bet.pick === "home" ? home : away} to win`;
    case "DC":
      return bet.pick === "homeDraw" ? `${home} or draw` : `${away} or draw`;
  }
}

/** The value trends to record from these cards: on matches kicking off in the next 3 hours, best two per match. */
export function valuePicks(cards: EdgeCard[], now = new Date()): Array<{ card: EdgeCard; trend: EdgeTrend }> {
  const out: Array<{ card: EdgeCard; trend: EdgeTrend }> = [];
  for (const card of cards) {
    const k = Date.parse(card.fixture.kickoff);
    if (k < now.getTime() || k > now.getTime() + WINDOW_MS) continue;
    const taken = new Set<string>();
    let n = 0;
    for (const trend of card.trends
      .filter((t) => t.bet && family(t.bet) !== "result" && t.sample >= MIN_SAMPLE && t.betfair && t.betfair.price !== null && (t.betfair.edge ?? 0) >= MIN_EDGE && t.betfair.marketId && t.betfair.marketType && t.betfair.selection && t.betfair.selectionId !== undefined && t.betfair.eventId)
      .sort((a, b) => b.betfair!.edge! - a.betfair!.edge!)) {
      const f = family(trend.bet!);
      const clash = f === "result" ? taken.has("result") : taken.has(f === "goalsUp" ? "goalsDown" : "goalsUp");
      if (clash || n >= PER_MATCH) continue;
      taken.add(f);
      n++;
      out.push({ card, trend });
    }
  }
  return out;
}

function detailFor(card: EdgeCard, trend: EdgeTrend, selection: string): ParsedAlert & { edge: EdgePickInfo } {
  const b = trend.betfair!;
  const f = card.fixture;
  return {
    strategyRaw: STRATEGY,
    strategyKey: KEY_NAME,
    strategyParts: [KEY_NAME],
    market: null,
    underdog: null,
    favourite: null,
    selection,
    targetLine: null,
    kickoffRaw: null,
    competition: f.league,
    country: f.country,
    positions: null,
    home: f.home,
    away: f.away,
    timerRaw: null,
    minute: null,
    lastGoal: null,
    goalsHome: null,
    goalsAway: null,
    stats: {},
    odds: { preMatch1x2: null, live1x2: null, overUnderLine: null, over: null, under: null },
    matched: null,
    strikeRate: null,
    freePick: null,
    htScore: null,
    ftScore: null,
    result: null,
    alertResult: null,
    resultSource: null,
    flags: [],
    sendable: true,
    edge: { bet: trend.bet!, trend: trend.text, kickoff: f.kickoff, marketId: b.marketId!, selectionId: b.selectionId!, marketType: b.marketType!, selectionName: b.selection!, price: b.price!, needed: b.needed!, edge: b.edge! },
  };
}

/** Records new Best Value Cuppa picks from freshly priced cards. Returns how many were added. */
export function recordValuePicks(db: EngineDb, cards: EdgeCard[], now = new Date()): number {
  const picks = valuePicks(cards, now);
  if (picks.length === 0) return 0;
  const settings = getSendingSettings(db);
  const staked = resolveStake(settings, KEY_NAME, getBank(db), { now, live: false });
  const stake = staked.stake ?? 1;
  const minPrice = settings.minOdds[KEY_NAME] ?? null;
  // Live: the bet feed takes the pick (and the Sim recording catches it if the feed doesn't send it in time).
  const live = settings.enabled && settings.strategies[KEY_NAME] === true;
  let added = 0;
  for (const { card, trend } of picks) {
    const b = trend.betfair!;
    const [bfHome, bfAway] = (b.event ?? "").split(/ v /i).map((s) => s.trim());
    const home = bfHome || card.fixture.home;
    const away = bfAway || card.fixture.away;
    const selection = betWords(trend.bet!, home, away);
    const skipped = minPrice !== null && b.price! < minPrice ? `Odds ${b.price!.toFixed(2)} were below the minimum ${minPrice.toFixed(2)}.` : null;
    const ok = db.addEdgePick({
      messageId: pickId(card, trend.bet!),
      strategy: STRATEGY,
      selection,
      competition: card.fixture.league,
      country: card.fixture.country,
      home: card.fixture.home,
      away: card.fixture.away,
      text: `${STRATEGY}\n${card.fixture.country} ${card.fixture.league}\n${card.fixture.home} vs ${card.fixture.away}\n${selection} @ ${b.price!.toFixed(2)} (Betfair)\nWhy: ${trend.text}. The price needs ${Math.round(b.needed! * 100)}% after commission; the trend's cautious rate is ${Math.round(trend.strength * 100)}%.`,
      detail: detailFor(card, trend, selection),
      event: b.event ?? `${home} v ${away}`,
      eventId: b.eventId!,
      odds: b.price!,
      simRowJson: live ? null : JSON.stringify({ stake: skipped === null ? stake : null, minPrice, skipped }),
      at: now.toISOString(),
    });
    if (ok) added++;
  }
  if (added > 0) log.info(`${STRATEGY}: ${added} new Sim pick${added === 1 ? "" : "s"}.`);
  return added;
}

/** Settles finished picks from Betfair's result. Returns how many were settled or set aside. */
export async function settleValuePicks(db: EngineDb, reader: Pick<BetfairReader, "runnerResult">, now = new Date()): Promise<number> {
  let done = 0;
  for (const p of db.listOpenEdgePicks()) {
    const info = (p.detail as ParsedAlert & { edge?: EdgePickInfo }).edge;
    if (!info) continue;
    const ko = Date.parse(info.kickoff);
    if (now.getTime() < ko + SETTLE_AFTER_MS) continue;
    const r = await reader.runnerResult(info.marketId, info.selectionId).catch(() => null);
    if (r === "WINNER" || r === "LOSER") {
      db.settleEdgePick(p.id, r === "WINNER" ? "hit" : "miss", now.toISOString());
      done++;
    } else if (r === "REMOVED" || now.getTime() > ko + GIVE_UP_MS) {
      db.setPickExcluded(p.id, true);
      done++;
    }
  }
  return done;
}

let settling = false;

/** Every 30 minutes (and a few minutes after start): settle what has finished. */
export function startValueSettling(db: EngineDb): void {
  const run = async () => {
    const reader = getExchangeReader();
    if (!reader || settling) return;
    settling = true;
    try {
      const n = await settleValuePicks(db, reader);
      if (n > 0) log.info(`${STRATEGY}: ${n} pick${n === 1 ? "" : "s"} settled.`);
    } catch (err) {
      log.warn(`${STRATEGY} settling: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      settling = false;
    }
  };
  setTimeout(() => void run(), 5 * 60_000).unref?.();
  setInterval(() => void run(), SETTLE_EVERY_MS).unref?.();
}

// ---- Bet by hand ----------------------------------------------------------------------------------------------------
