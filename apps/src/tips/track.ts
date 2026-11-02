/**
 * TELEGRAM TIPS: the free tips read from the chosen channels (tips/reader.ts), recorded as a strategy of their own so they
 * build a Sim record like every other strategy (Strategies, Results, Win/Loss). Set up 2 Nov 2026.
 *
 *   picks    each message taken as a tip (the reading, or "Tip" on the Free tips page; "Not a tip" always wins) whose bet
 *            can be placed on Betfair before kick-off: match goals over/under, both teams to score, or a team/draw in Match
 *            Odds. Anything else (corners, cards, halves, double chance, accumulators) is shown on the page as not tracked.
 *   price    Betfair's best back price when the tip is read, not the price the channel quoted: that is what could really
 *            have been had. The channel's own price stays in the pick's text, for comparing.
 *   stake    in Sim, the strategy's stake on Strategies, else £1, so the record reads per £1 until one is set.
 *   settled  from Betfair's own result for the market, by the same job as Best Value Cuppa (edge/value-strategy.ts).
 *   Live     like any strategy, only when switched Live on Strategies. It starts in Sim.
 */
import type { EngineDb } from "../storage/engine-db";
import type { BetfairReader } from "../betfair/exchange";
import type { ParsedAlert } from "../inplayguru/parse-alert";
import { judgeExchange, searchWord } from "../betfair/exchange";
import { sameOrder } from "../edge/edge-prices";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { getBank, resolveStake } from "../inplayguru/stake";
import { log } from "../server/log";

export const TIPS_STRATEGY = "Telegram tips";
const KEY_NAME = TIPS_STRATEGY.toLowerCase();
/** A tip is looked at while it is this young; after that, if it still can't be placed, it is set aside. */
const MAX_AGE_MS = 36 * 3_600_000;

export interface TipBet {
  marketType: string;
  /** Betfair's runner name, or "home"/"away"/"draw" for Match Odds until the event is found. */
  selectionName: string;
  words: string;
}
export type TipBetRead = TipBet | { reason: string };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Which Betfair bet a tip is, or why it can't be tracked. Pure. */
export function readTipBet(selection: string | null, text: string, home: string, away: string): TipBetRead {
  const sel = (selection ?? "").trim();
  const all = plain(`${sel} ${text}`);
  if (/corner|card|booking|scorer|to score first|handicap|ah\b|acca|accumulator|double chance|1x\b|x2\b|or draw|draw or|first half|1st half|second half|2nd half|half.?time|ht\/ft/.test(all)) {
    return { reason: "Only match goals, both teams to score and a team or draw to win are tracked." };
  }
  const s = plain(sel || text);
  const ou = /\b(over|under)\s*(\d(?:\.5))\b/.exec(s);
  if (ou) {
    const line = ou[2]!;
    const code = `OVER_UNDER_${line.replace(".", "")}`;
    return { marketType: code, selectionName: `${ou[1] === "over" ? "Over" : "Under"} ${line} Goals`, words: `${ou[1] === "over" ? "Over" : "Under"} ${line} goals` };
  }
  if (/btts|both teams to score/.test(s)) {
    const no = /\bno\b|\bnot\b|\bn\b/.test(s.replace(/both teams to score|btts/g, ""));
    return { marketType: "BOTH_TEAMS_TO_SCORE", selectionName: no ? "No" : "Yes", words: `Both teams to score: ${no ? "No" : "Yes"}` };
  }
  const h = plain(searchWord(home));
  const a = plain(searchWord(away));
  const mentionsHome = s.includes(h);
  const mentionsAway = s.includes(a);
  if (/\bdraw\b/.test(s) && !mentionsHome && !mentionsAway) return { marketType: "MATCH_ODDS", selectionName: "draw", words: "The Draw" };
  if (mentionsHome !== mentionsAway && /\b(win|wins|to win|ml|moneyline|1)\b|^[a-z .'-]+$/.test(s)) {
    return mentionsHome ? { marketType: "MATCH_ODDS", selectionName: "home", words: `${home} to win` } : { marketType: "MATCH_ODDS", selectionName: "away", words: `${away} to win` };
  }
  return { reason: "Couldn't tell which bet this is." };
}

/** A stable message id for one tip, so the same tip is never added twice. */
function pickId(chatKey: string, messageId: number): number {
  const s = `${chatKey}|${messageId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}

function detailFor(home: string, away: string, selection: string, e: { kickoff: string; marketId: string; selectionId: number; marketType: string; selectionName: string; price: number }): ParsedAlert {
  return {
    strategyRaw: TIPS_STRATEGY,
    strategyKey: KEY_NAME,
    strategyParts: [KEY_NAME],
    market: null,
    underdog: null,
    favourite: null,
    selection,
    targetLine: null,
    kickoffRaw: null,
    competition: "Unknown",
    country: "",
    positions: null,
    home,
    away,
    timerRaw: null,
    minute: null,
    lastGoal: null,
    goalsHome: null,
    goalsAway: null,
    stats: {},
    odds: { preMatch1x2: null, live1x2: null, overUnderLine: null, over: null, under: null, lines: [] },
    matched: null,
    strikeRate: null,
    strikeRatePicks: null,
    strikeRateLeague: null,
    strikeRateLeaguePicks: null,
    freePick: null,
    htScore: null,
    ftScore: null,
    result: null,
    alertResult: null,
    resultSource: null,
    flags: [],
    sendable: true,
    // What settleValuePicks and the bet feed read; no `bet` or trend: this is not an Edge pick.
    edge: { trend: "Telegram tip", needed: 0, edge: 0, ...e },
  } as unknown as ParsedAlert;
}

type Outcome = { done: true } | { done: false; retry: boolean; reason: string };

async function trackOne(
  db: EngineDb,
  reader: Pick<BetfairReader, "searchEvents" | "checkBet">,
  t: { chatKey: string; messageId: number; channel: string; postedAt: string; text: string; match: string | null; selection: string | null; odds: number | null },
  now: Date,
): Promise<Outcome> {
  if (!t.match) return { done: false, retry: false, reason: "No match named." };
  const [home = "", away = ""] = t.match.split(" v ");
  const bet = readTipBet(t.selection, t.text, home, away);
  if ("reason" in bet) return { done: false, retry: false, reason: bet.reason };

  const at = new Date(t.postedAt);
  const find = async (word: string) => judgeExchange(home, away, await reader.searchEvents(word, at));
  let judged = await find(searchWord(home));
  if (judged.result === "off") judged = await find(searchWord(away));
  if (judged.result !== "on" || !judged.eventId || !judged.event || !sameOrder(home, away, judged.event)) {
    return { done: false, retry: true, reason: "Match not found on Betfair." };
  }
  const events = await reader.searchEvents(searchWord(home), at);
  const open = events.find((e) => e.id === judged.eventId)?.openDate;
  if (!open) return { done: false, retry: true, reason: "Kick-off time not known yet." };
  if (Date.parse(open) <= now.getTime()) return { done: false, retry: false, reason: "Already kicked off when read." };

  const [bfHome = home, bfAway = away] = judged.event.split(/ v /i).map((s) => s.trim());
  const selectionName = bet.selectionName === "home" ? bfHome : bet.selectionName === "away" ? bfAway : bet.selectionName === "draw" ? "The Draw" : bet.selectionName;
  const check = await reader.checkBet(judged.eventId, bet.marketType, selectionName);
  if (check.status !== "ok" || check.marketId === undefined || check.selectionId === undefined) {
    return { done: false, retry: false, reason: check.status === "noMarket" ? "Betfair has no such market." : "Betfair has no such selection." };
  }
  if (check.price === null) return { done: false, retry: true, reason: "No price on Betfair yet." };

  const settings = getSendingSettings(db);
  const staked = resolveStake(settings, KEY_NAME, getBank(db), { now, live: false });
  const stake = staked.stake ?? 1;
  const minPrice = settings.minOdds[KEY_NAME] ?? null;
  const live = settings.enabled && settings.strategies[KEY_NAME] === true;
  const skipped = minPrice !== null && check.price < minPrice ? `Odds ${check.price.toFixed(2)} were below the minimum ${minPrice.toFixed(2)}.` : null;
  db.addEdgePick({
    messageId: pickId(t.chatKey, t.messageId),
    strategy: TIPS_STRATEGY,
    selection: bet.words,
    competition: "Unknown",
    country: "",
    home,
    away,
    text: `${TIPS_STRATEGY}\n${t.channel}\n${home} vs ${away}\n${bet.words} @ ${check.price.toFixed(2)} (Betfair)${t.odds !== null ? `\nThe channel quoted ${t.odds}.` : ""}\n\n${t.text.slice(0, 400)}`,
    detail: detailFor(home, away, bet.words, { kickoff: open, marketId: check.marketId, selectionId: check.selectionId, marketType: bet.marketType, selectionName, price: check.price }),
    event: judged.event,
    eventId: judged.eventId,
    odds: check.price,
    simRowJson: live ? null : JSON.stringify({ stake: skipped === null ? stake : null, minPrice, skipped }),
    at: now.toISOString(),
  });
  return { done: true };
}

/** Records the new tips that can be placed. Returns how many were added. Called after each read of the channels. */
export async function trackTips(db: EngineDb, reader: Pick<BetfairReader, "searchEvents" | "checkBet">, now = new Date()): Promise<number> {
  let added = 0;
  for (const t of db.listUntrackedTips(new Date(now.getTime() - MAX_AGE_MS).toISOString())) {
    try {
      const r = await trackOne(db, reader, t, now);
      if (r.done) {
        db.setChannelTipTracked(t.chatKey, t.messageId, "done");
        added++;
      } else if (!r.retry) db.setChannelTipTracked(t.chatKey, t.messageId, `no: ${r.reason}`);
      else if (now.getTime() - Date.parse(t.postedAt) > MAX_AGE_MS - 3_600_000) db.setChannelTipTracked(t.chatKey, t.messageId, `no: ${r.reason}`);
    } catch (err) {
      log.warn(`${TIPS_STRATEGY}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (added > 0) log.info(`${TIPS_STRATEGY}: ${added} new Sim pick${added === 1 ? "" : "s"}.`);
  return added;
}
