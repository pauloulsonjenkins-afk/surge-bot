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

/**
 * Every channel's tips are one strategy, "Telegram tips" (the owner, 14 Nov 2026): one record, one switch, one stake.
 * Each channel was a strategy of its own before ("Telegram: <channel name>"), which left four records of 1 to 7 picks.
 * The channel is still on every pick (its text) and in every notification.
 */
export const TIPS_STRATEGY = "Telegram tips";
export const OLD_TIPS_PREFIX = "Telegram: ";
export function tipsStrategy(_channel?: string): string {
  return TIPS_STRATEGY;
}

/**
 * Reports the old one-per-channel strategies under "Telegram tips" (the Strategies page's own merge, so nothing is
 * rewritten and it can be undone there). Needs a first "Telegram tips" pick to merge into. Returns how many were merged.
 */
export function mergeOldTipStrategies(db: EngineDb): number {
  const seen = db.listStrategiesSeen().map((s) => s.label);
  if (!seen.some((l) => l.toLowerCase() === TIPS_STRATEGY.toLowerCase())) return 0;
  const merges = db.getStrategyMerges();
  let merged = 0;
  for (const label of seen) {
    if (!label.toLowerCase().startsWith(OLD_TIPS_PREFIX.toLowerCase()) || merges[label.toLowerCase()]) continue;
    if (db.setStrategyMerge(label, TIPS_STRATEGY).ok) merged++;
  }
  return merged;
}
/** A tip is looked at while it is this young; after that, if it still can't be placed, it is set aside. */
const MAX_AGE_MS = 36 * 3_600_000;
/** An in-play tip must be read within this long of being posted, so Betfair's price is still the tip's price. */
const IN_PLAY_FRESH_MS = 10 * 60_000;
/** A match kicked off longer ago than this is over (with extra time and delays). */
const IN_PLAY_OVER_MS = 3.5 * 3_600_000;

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
  // The bet's own line decides. The rest of the post is read only when no line was picked out: a write-up mentions
  // half-time, cards and corners for its own reasons, and that was ruling out bets that could be tracked (14 Nov 2026).
  const s = plain(sel || text);
  const NOT_TRACKED = "Only goals (match or first half), both teams to score, a team or draw to win, and double chance are tracked.";
  if (/corner|card|booking|scorer|to score first|handicap|\bah\b|acca|accumulator|ht\/ft|second half|2nd half/.test(s)) return { reason: NOT_TRACKED };
  if (/\b(over|under)\s*\d{2,3}(\.\d)?\b|\bpoints\b.*\b(over|under)\b|\b(sets?|rebounds|runs)\b/.test(s)) return { reason: "Only football bets are tracked." };
  const h = plain(searchWord(home));
  const a = plain(searchWord(away));
  const mentionsHome = h.length > 0 && s.includes(h);
  const mentionsAway = a.length > 0 && s.includes(a);
  const goals = /\b(over|under)\s*(\d(?:\.\d{1,2})?)\b/.exec(s);
  const btts = /btts|both teams to score/.test(s);
  const winner = /\b(to win|wins?|ml|moneyline)\b/.test(s);
  if (sel && [goals !== null, btts, winner].filter(Boolean).length > 1) return { reason: "Two bets in one (like a win and over 1.5 goals) aren't tracked." };
  const firstHalf = /first[- ]half|1st[- ]half|\bfh\b|half[- ]?time|\bht\b/.test(s);
  if (goals) {
    const line = goals[2]!;
    if (!/^\d\.5$/.test(line)) return { reason: "Asian goal lines (like 2.0 or 2.25) aren't tracked, only whole-and-a-half lines like 2.5." };
    const side = goals[1] === "over" ? "Over" : "Under";
    if (firstHalf) return { marketType: `FIRST_HALF_GOALS_${line.replace(".", "")}`, selectionName: `${side} ${line} Goals`, words: `${side} ${line} first-half goals` };
    return { marketType: `OVER_UNDER_${line.replace(".", "")}`, selectionName: `${side} ${line} Goals`, words: `${side} ${line} goals` };
  }
  if (firstHalf) return { reason: NOT_TRACKED };
  if (btts) {
    const no = /\bno\b|\bnot\b|\bn\b/.test(s.replace(/both teams to score|btts/g, ""));
    return { marketType: "BOTH_TEAMS_TO_SCORE", selectionName: no ? "No" : "Yes", words: `Both teams to score: ${no ? "No" : "Yes"}` };
  }
  // Double chance: "Al Nairyah or draw (1X)", "Boulogne or draw (X2)", "double chance".
  const dcHome = /\b1x\b/.test(s) || (mentionsHome && !mentionsAway && /\bor draw\b|\bdraw or\b|double chance/.test(s));
  const dcAway = /\bx2\b/.test(s) || (mentionsAway && !mentionsHome && /\bor draw\b|\bdraw or\b|double chance/.test(s));
  if (dcHome !== dcAway) {
    return dcHome
      ? { marketType: "DOUBLE_CHANCE", selectionName: "home-or-draw", words: `${home} or draw` }
      : { marketType: "DOUBLE_CHANCE", selectionName: "draw-or-away", words: `${away} or draw` };
  }
  if (/\bor draw\b|\bdraw or\b|double chance/.test(s)) return { reason: "Couldn't tell which side of the double chance this is." };
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

function detailFor(strategy: string, home: string, away: string, selection: string, e: { kickoff: string; marketId: string; selectionId: number; marketType: string; selectionName: string; price: number }): ParsedAlert {
  return {
    strategyRaw: strategy,
    strategyKey: strategy.toLowerCase(),
    strategyParts: [strategy.toLowerCase()],
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
  t: { chatKey: string; messageId: number; channel: string; postedAt: string; text: string; match: string | null; selection: string | null; odds: number | null; mine?: boolean },
  now: Date,
): Promise<Outcome> {
  if (!t.match) return { done: false, retry: false, reason: "No match named." };
  const [home = "", away = ""] = t.match.split(" v ");
  // The owner's own reading of the bet is read on its own: the message's text may mention "first half" or a card for other reasons.
  const bet = readTipBet(t.selection, t.mine ? "" : t.text, home, away);
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
  // In-play tips (posted after kick-off, "4th minute, 0-0") are tracked too, priced at Betfair's live price when read. That
  // price only means something if it is read soon after the post, and the match must still be on.
  const inPlay = Date.parse(open) <= now.getTime();
  if (inPlay) {
    if (now.getTime() - Date.parse(t.postedAt) > IN_PLAY_FRESH_MS) return { done: false, retry: false, reason: "In-play tip read more than 10 minutes after it was posted: Betfair's price by then isn't the tip's." };
    if (now.getTime() - Date.parse(open) > IN_PLAY_OVER_MS) return { done: false, retry: false, reason: "The match was already over." };
  }

  const [bfHome = home, bfAway = away] = judged.event.split(/ v /i).map((s) => s.trim());
  const settings = getSendingSettings(db);
  // Double chance uses the same wording the bet feed sends for the underdog bets (Betting, Limits, Bet wording).
  const fill = (template: string) => template.replace(/\{home\}/g, bfHome).replace(/\{away\}/g, bfAway);
  const selectionName =
    bet.selectionName === "home" ? bfHome
    : bet.selectionName === "away" ? bfAway
    : bet.selectionName === "draw" ? "The Draw"
    : bet.selectionName === "home-or-draw" ? fill(settings.underdogHomeSelection)
    : bet.selectionName === "draw-or-away" ? fill(settings.underdogAwaySelection)
    : bet.selectionName;
  const check = await reader.checkBet(judged.eventId, bet.marketType, selectionName);
  if (check.status !== "ok" || check.marketId === undefined || check.selectionId === undefined) {
    return { done: false, retry: false, reason: check.status === "noMarket" ? "Betfair has no such market." : "Betfair has no such selection." };
  }
  if (check.price === null) return { done: false, retry: true, reason: "No price on Betfair yet." };

  const strategy = tipsStrategy(t.channel);
  const KEY_NAME = strategy.toLowerCase();
  const staked = resolveStake(settings, KEY_NAME, getBank(db), { now, live: false });
  const stake = staked.stake ?? 1;
  const minPrice = settings.minOdds[KEY_NAME] ?? null;
  // An in-play tip is Sim only: the bet feed places bets up to kick-off, so it could never be sent for real.
  const live = !inPlay && settings.enabled && settings.strategies[KEY_NAME] === true;
  const skipped = minPrice !== null && check.price < minPrice ? `Odds ${check.price.toFixed(2)} were below the minimum ${minPrice.toFixed(2)}.` : null;
  db.addEdgePick({
    messageId: pickId(t.chatKey, t.messageId),
    strategy,
    selection: bet.words,
    competition: "Unknown",
    country: "",
    home,
    away,
    text: `${strategy}\n${t.channel}\n${home} vs ${away}\n${bet.words} @ ${check.price.toFixed(2)} (Betfair${inPlay ? ", in-play" : ""})${t.odds !== null ? `\nThe channel quoted ${t.odds}.` : ""}\n\n${t.text.slice(0, 400)}`,
    detail: detailFor(strategy, home, away, bet.words, { kickoff: open, marketId: check.marketId, selectionId: check.selectionId, marketType: bet.marketType, selectionName, price: check.price }),
    event: judged.event,
    eventId: judged.eventId,
    odds: check.price,
    simRowJson: live ? null : JSON.stringify({ stake: skipped === null ? stake : null, minPrice, skipped }),
    at: now.toISOString(),
  });
  return { done: true };
}

/** The bets the Free tips page offers for "this is the bet", as words readTipBet reads back (for the ones that can be priced on Betfair). */
export type MyBet = { kind: "home" | "away" | "draw" | "btts-yes" | "btts-no" } | { kind: "over" | "under"; line: number } | { kind: "other"; text: string };

/** The bet in words, or why it isn't one. Pure. */
export function myBetWords(match: string | null, bet: MyBet): { words: string; tracked: boolean } | { error: string } {
  const [home = "", away = ""] = (match ?? "").split(" v ");
  if (bet.kind === "other") {
    const text = bet.text.trim().slice(0, 80);
    return text ? { words: text, tracked: false } : { error: "Say what the bet is." };
  }
  if ((bet.kind === "home" || bet.kind === "away") && !match) return { error: "No match was read from this post, so a team can't be picked." };
  if (bet.kind === "home") return { words: `${home} to win`, tracked: true };
  if (bet.kind === "away") return { words: `${away} to win`, tracked: true };
  if (bet.kind === "draw") return { words: "The draw", tracked: true };
  if (bet.kind === "btts-yes") return { words: "Both teams to score: Yes", tracked: true };
  if (bet.kind === "btts-no") return { words: "Both teams to score: No", tracked: true };
  if (bet.kind !== "over" && bet.kind !== "under") return { error: "Pick one of the bets listed." };
  if (!(bet.line >= 0.5 && bet.line <= 9.5 && bet.line % 1 === 0.5)) return { error: "Goal lines are whole-and-a-half numbers, like 2.5." };
  return { words: `${bet.kind === "over" ? "Over" : "Under"} ${bet.line} goals`, tracked: true };
}

/**
 * A tip the system can't place or settle by itself (a first-half bet, a corner, a match Betfair doesn't list) recorded as a Sim
 * pick from what the owner says: the bet, its odds, and how it ended. It counts in the channel's strategy like any other pick, at
 * the strategy's Sim stake. A tip already recorded can't be added twice: amend that pick's result instead (Fix a result).
 */
export function recordTipByHand(
  db: EngineDb,
  t: { chatKey: string; messageId: number; channel: string; postedAt: string; match: string | null },
  by: { words: string; odds: number; result: "won" | "lost" },
  now = new Date(),
): { ok: true } | { ok: false; error: string } {
  if (!t.match) return { ok: false, error: "No match was read from this post, so there is nothing to record it against." };
  if (!(by.odds > 1 && by.odds < 1000)) return { ok: false, error: "Give the odds as a decimal, like 1.85." };
  const [home = "", away = ""] = t.match.split(" v ");
  const strategy = tipsStrategy(t.channel);
  const settings = getSendingSettings(db);
  const stake = resolveStake(settings, strategy.toLowerCase(), getBank(db), { now, live: false }).stake ?? 1;
  const added = db.addEdgePick({
    messageId: pickId(t.chatKey, t.messageId),
    strategy,
    selection: by.words,
    competition: "Unknown",
    country: "",
    home,
    away,
    text: `${strategy}
${t.channel}
${home} vs ${away}
${by.words} @ ${by.odds.toFixed(2)} (recorded by hand)

${db.getChannelTipText(t.chatKey, t.messageId)?.slice(0, 400) ?? ""}`,
    detail: detailFor(strategy, home, away, by.words, { kickoff: t.postedAt, marketId: "", selectionId: 0, marketType: "BY_HAND", selectionName: by.words, price: by.odds }),
    event: t.match.replace(" v ", " v "),
    eventId: "by-hand",
    odds: by.odds,
    simRowJson: JSON.stringify({ stake, minPrice: null, skipped: null }),
    at: t.postedAt,
  });
  if (!added) return { ok: false, error: "This tip is already recorded as a pick. Amend that pick's result with Fix a result." };
  const id = db.findEdgePickId(pickId(t.chatKey, t.messageId));
  if (id !== null) db.settleEdgePick(id, by.result === "won" ? "hit" : "miss", now.toISOString());
  db.setChannelTipTracked(t.chatKey, t.messageId, "done");
  return { ok: true };
}

/**
 * "This is the bet" from the Free tips page. A bet Betfair lists is kept as the tip's own reading and put back in the queue to be
 * priced and settled from Betfair; with `result` (or a bet that can't be priced) it is recorded by hand instead, from the odds and
 * result given. Either way the tip counts as one the owner took. Returns an error in words, or null.
 */
export function applyMyBet(
  db: EngineDb,
  body: { chatKey: string; messageId: number; bet: MyBet; odds?: number | null; result?: "won" | "lost" | null },
  now = new Date(),
): string | null {
  const tip = db.getChannelTip(body.chatKey, body.messageId);
  if (!tip) return "That message isn't stored any more.";
  const read = myBetWords(tip.match, body.bet);
  if ("error" in read) return read.error;
  const odds = typeof body.odds === "number" && Number.isFinite(body.odds) ? body.odds : null;
  if (body.result === "won" || body.result === "lost" || !read.tracked) {
    if (body.result !== "won" && body.result !== "lost") return "For a bet Betfair can't price, say how it ended (won or lost) and its odds.";
    const r = recordTipByHand(db, tip, { words: read.words, odds: odds ?? 0, result: body.result }, now);
    if (!r.ok) return r.error;
    db.setChannelTipBet(body.chatKey, body.messageId, read.words, odds);
    db.setChannelTipReview(body.chatKey, body.messageId, "tip");
    return null;
  }
  // Already recorded from this tip: the earlier pick stays; a change of bet is made by amending its result.
  if (tip.tracked === "done") return "This tip is already recorded as a pick. Amend that pick's result with Fix a result.";
  db.setChannelTipBet(body.chatKey, body.messageId, read.words, odds);
  db.setChannelTipReview(body.chatKey, body.messageId, "tip");
  db.setChannelTipTracked(body.chatKey, body.messageId, null);
  return null;
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
      log.warn(`Telegram tips: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (added > 0) {
    log.info(`Telegram tips: ${added} new Sim pick${added === 1 ? "" : "s"}.`);
    const merged = mergeOldTipStrategies(db);
    if (merged > 0) log.info(`Telegram tips: ${merged} old one-per-channel strateg${merged === 1 ? "y is" : "ies are"} now reported under "${TIPS_STRATEGY}".`);
  }
  return added;
}
