/**
 * Claude's per-alert second opinion (design in docs/claude-in-goalbrew.md, phase 1).
 *
 * ADVISORY ONLY. This file never touches SendingSettings, buildFeed, direct betting, or any switch that places,
 * skips or cancels a bet (inplayguru/bet-feed.ts, betfair/direct.ts). It reads an already-parsed, already-stored
 * pick, asks Claude one narrow question — does this alert look stronger, in line with, or weaker than this
 * strategy's own usual pattern — and writes the answer to its own table (claude_verdicts). Callers fire it with
 * `void` after the pick is saved; it never delays or blocks anything else, and it never throws past its own
 * boundary (every failure is caught and logged, leaving no verdict rather than a wrong one).
 *
 * Needs ANTHROPIC_API_KEY set on the engine. Without it, claudeConfigured() is false and checkAlertWithClaude is
 * a no-op, so the feature is off by default and safe to deploy before the key exists.
 */
import Anthropic from "@anthropic-ai/sdk";
import { leagueIdentity, type EngineDb, type LivePick } from "../storage/engine-db";
import { computeLeagueReturns } from "./league-returns";
import { alertOddsOfPick, pickFacts, pickSegments, strategyLabel } from "../inplayguru/bet-feed";
import { layGroups } from "../inplayguru/lay-groups";
import { clashOf, exposureOf } from "../inplayguru/clash";
import { computeStrategyForm } from "./winloss";
import { historyMatches, leagueProfiles, tablePositions } from "../history/football-data";
import { isStaleExchangePrice } from "./pricing";
import { edgeCard, edgeCards } from "../edge/edge";
import { describeTrackRecord, trackRecord } from "./claude-track-record";
import { goldenReport } from "./golden";
import { cachedReport } from "./report-cache";
import { log } from "./log";

/** Cheap by design (see docs/claude-in-goalbrew.md § 3): a bounded classification call, not a chat. */
const MODEL = "claude-haiku-5-5";
/**
 * Used instead of MODEL only for the genuinely ambiguous alerts: a recent alert on the same match that pointed the
 * opposite way, or the market having moved against the alert since it fired (isAmbiguous below). These are exactly
 * the cases where Haiku's weaker reasoning is riskiest (27 Oct 2026's LAY-direction mistake was one), and they're
 * rare, so this costs a small fraction of running Sonnet on every alert - the owner declined that on cost alone.
 */
const AMBIGUOUS_MODEL = "claude-sonnet-5-5";

/** Whether this alert's context has one of the two signals worth a sharper model: see AMBIGUOUS_MODEL above. */
export function isAmbiguous(context: Record<string, unknown>): boolean {
  if (context.contradictingAlertsOnThisMatch !== null) return true;
  const movement = context.marketPriceMovementSinceAlert;
  return typeof movement === "string" && movement.includes("drifted");
}

const SYSTEM_PROMPT = [
  "You are a second opinion on in-play football betting alerts for GoalBrew, a betting assistant.",
  "You never place, skip, or recommend placing a bet. You only judge whether THIS one alert looks stronger, in",
  "line with, or weaker than its strategy's own usual pattern, using only the data given.",
  "WATCH THE DIRECTION: when market ends _LAY, or selection starts 'LAY', the bet wins only if the stated outcome",
  "does NOT happen (e.g. 'LAY Over 1.5 Goals' wins if no more goals come). Stats or pressure that make that outcome",
  "MORE likely (a team pushing hard for another goal, on a lay of more goals) make the alert WEAKER, not stronger -",
  "say so plainly rather than reading pressure as automatically good. For an ordinary (non-LAY) bet, pressure or form",
  "pointing towards the selection happening makes it stronger, as usual.",
  "recentFormAndHeadToHead and leagueTablePosition, when given, are the two teams' recent results, head-to-head",
  "record and current league position: weigh them alongside the in-play stats, and say in the note when they point",
  "the same way or the opposite way to the alert (e.g. a team near the bottom pressing hard is weaker evidence than",
  "the same pressure from a team near the top). Both are null for most leagues (data only covers the main European",
  "leagues) - when null, judge from the in-play stats alone and don't speculate about either team's history.",
  "marketPriceMovementSinceAlert, when given, says whether Betfair's price has shortened or drifted since the alert's",
  "own quote - an independent read, since the market reacts to things a stats line can't carry. Weigh it alongside",
  "the stats; a big drift against the alert is worth noting even if the in-play numbers look fine. It may instead say",
  "the price looks like a stale pre-goal reading (a delayed price) - then it isn't a real signal, so judge from the",
  "stats alone and don't mention the price.",
  "contradictingAlertsOnThisMatch, when given, lists other alerts on the SAME match in the last 30 minutes whose bet",
  "points the opposite way or partly disagrees. A recent contradiction is a real reason for caution, not noise.",
  "thisStrategyInThisLeague, when given, is this strategy's OWN settled record in this one league specifically (not",
  "the country's general stats) - a real weak or strong spot worth naming plainly when it disagrees with the alert.",
  "Null means too few picks there yet to mean anything, not that the league is fine - say nothing about it then.",
  "alertStrikeRate and alertStrikeRateInThisLeague are InPlayGuru's OWN live strike rate for this strategy (overall,",
  "and in this league) - a second, independent figure from thisStrategyInThisLeague, since it comes from InPlayGuru's",
  "whole user base rather than just this account's settled bets. The two agreeing is stronger evidence than either",
  "alone; the two disagreeing is worth a cautious note. Ignore a figure with too small a sample to mean much.",
  "preMatchEdgeValue, when given, is Edge's own pre-match analysis (edge.ts) for this exact match, already judged",
  "against an actual Betfair price before kick-off - real priced value, not just a stat. It agreeing with the alert",
  "is stronger evidence; it disagreeing (or pointing to a different selection) is worth a cautious note. Null for",
  "most matches (Edge only covers the main leagues it has pre-match data for) - say nothing about it then.",
  "goldenSlicesThisAlertIsIn, when given, is this alert's Golden slices (golden.ts) with their actual status and",
  "record - a slice already proved at full stake over hundreds of picks is real evidence; an unproven 'candidate' or",
  "'quiet' one with a handful of picks is not, whatever its name suggests. Weigh them accordingly, not just by name.",
  "yourPastVerdictsOnSettledAlerts, when given, is how your own earlier verdicts actually turned out once those picks",
  "settled. Use it to calibrate. If it says the verdicts aren't telling winners from losers (or have pointed the wrong",
  "way), your usual reasoning isn't predicting results yet: answer in_line unless this alert's evidence is clear, and",
  "do not lean on the same signals you have been leaning on. If it says the verdicts are helping, you can trust your",
  "usual reasoning more. Mention it in the note in a few words only when it changed your answer.",
  "If the data given doesn't support a confident view, answer in_line with low confidence rather than guessing.",
  "Always answer by calling the give_verdict tool exactly once. Never reply in plain text.",
].join(" ");

/**
 * A tool, called once, instead of asking for bare JSON in prose: 27 Oct 2026, the owner reported no verdicts were
 * landing at all even though the API key worked (the daily review, a different call, wrote its note fine that same
 * evening) - the likely cause was Haiku adding stray words around the JSON it was asked for in plain text, which
 * parseVerdict below couldn't recover from. Forcing a tool call makes the reply structured by the API itself, not by
 * hoping the model follows an instruction.
 */
const VERDICT_TOOL = {
  name: "give_verdict",
  description: "Give your verdict on this one alert.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: { type: "string", enum: ["stronger", "in_line", "weaker"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      note: { type: "string", description: "2-4 sentences, concrete, no filler. Finish the thought - never trail off or leave a sentence half-written." },
    },
    required: ["verdict", "confidence", "note"],
  },
};

let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

/** Whether the per-alert check can run at all (ANTHROPIC_API_KEY is set). False means every call below no-ops. */
export function claudeConfigured(): boolean {
  return getClient() !== null;
}

/** The league profile (home/draw/away splits, goals, etc.) for an alert's country, from football-data.ts. Best effort: picks the first division on file for that country, so a country with several divisions is approximated by one of them. */
function leagueProfileFor(country: string | null) {
  if (!country) return null;
  const match = leagueProfiles().find((p) => p.country.toLowerCase() === country.toLowerCase());
  if (!match) return null;
  return { homePct: match.homePct, drawPct: match.drawPct, awayPct: match.awayPct, avgGoals: match.avgGoals, over25Pct: match.over25Pct, bttsPct: match.bttsPct };
}

/**
 * The two teams' recent goals/form and head-to-head (edge/edge.ts's own trends, built from football-data.co.uk's
 * results): reused as-is rather than recomputed, so this always agrees with what Edge shows members. Only the main
 * European and a handful of other leagues are on file, so most lower-league and non-European alerts (most of what
 * InPlayGuru actually sends) get null here - that's expected, not a bug, and Claude is told not to guess past it.
 */
function headToHeadFor(pick: LivePick, now: Date): string[] | null {
  if (!pick.home || !pick.away) return null;
  const card = edgeCard({ div: "", league: "", country: "", kickoff: now.toISOString(), home: pick.home, away: pick.away }, historyMatches(), now);
  return card.trends.length > 0 ? card.trends.map((t) => t.text) : null;
}

/**
 * Edge's own pre-match value picks for this exact match (edge/edge.ts, stored ahead of kick-off for members'
 * Fixtures page): where it already found a trend priced better than Betfair's own line, before the match even
 * started. A different thing from recentFormAndHeadToHead above (the same trends, but unpriced) - this is only the
 * ones Edge judged as real mispriced value against an actual Betfair price, read in the 24 hours before kick-off.
 * Null when this match has no stored card (most lower leagues) or nothing in it priced as value.
 */
function preMatchEdgeValueFor(db: EngineDb, pick: LivePick, now: Date): string[] | null {
  if (!pick.home || !pick.away) return null;
  const card = edgeCards(db, now).find((c) => c.fixture.home === pick.home && c.fixture.away === pick.away);
  if (!card) return null;
  const value = card.trends.filter((t) => t.betfair && t.betfair.edge !== null && t.betfair.edge > 0);
  if (value.length === 0) return null;
  return value.map((t) => `${t.text} - priced at ${t.betfair!.price}, needs ${t.betfair!.needed}% to break even, this trend's own rate is higher (edge +${Math.round(t.betfair!.edge! * 10) / 10}pts)`);
}

/** Each side's league position right now, computed from results already on file - free, no new data source. */
function tablePositionsFor(pick: LivePick, now: Date): { home: string | null; away: string | null } | null {
  if (!pick.home || !pick.away) return null;
  const positions = tablePositions(historyMatches(), pick.home, pick.away, now);
  if (!positions) return null;
  return {
    home: positions.home ? `${positions.home.position} of ${positions.home.of}` : null,
    away: positions.away ? `${positions.away.position} of ${positions.away.of}` : null,
  };
}

/**
 * How Betfair's price has moved since the alert's own quoted price: a second, independent read on this alert,
 * since the market reacts to everything (injuries, cards, context) a stats line can't carry. Null until Betfair's
 * price has actually been checked for this pick.
 */
function priceMovementFor(pick: LivePick): string | null {
  const alertOdds = alertOddsOfPick(pick);
  const nowOdds = pick.exchangeOdds;
  if (alertOdds === null || nowOdds === null || alertOdds <= 1) return null;
  // A delayed app key can show a price read before the goal the alert already counts (pricing.ts's own guard,
  // direct.ts uses the same check before betting): that isn't real market movement, so don't present it as one.
  if (isStaleExchangePrice(nowOdds, alertOdds)) return "Betfair's price looks like a stale pre-goal snapshot (a delayed price reading), not a real current price: not usable as a market-movement signal here.";
  const pctChange = Math.round(((nowOdds - alertOdds) / alertOdds) * 1000) / 10;
  if (Math.abs(pctChange) < 1) return `Betfair's price (${nowOdds.toFixed(2)}) is about the same as the alert's own quote (${alertOdds.toFixed(2)}): the market broadly agrees with the alert.`;
  return pctChange < 0
    ? `Betfair's price has shortened from ${alertOdds.toFixed(2)} to ${nowOdds.toFixed(2)} (${pctChange}%) since the alert: the market now favours this more than the alert's own price did.`
    : `Betfair's price has drifted from ${alertOdds.toFixed(2)} to ${nowOdds.toFixed(2)} (+${pctChange}%) since the alert: the market favours this less than the alert's own price did.`;
}

/**
 * Other alerts on the SAME match, in the last 30 minutes, whose bet cancels or partly disagrees with this one
 * (clash.ts's own logic, already used to keep a LAY from being made against a Live back bet). A human glancing at
 * Live would notice "wait, didn't it just say the opposite ten minutes ago" - Claude otherwise only ever sees one
 * alert at a time.
 */
function contradictingAlertsFor(db: EngineDb, pick: LivePick, now: Date): string[] | null {
  if (!pick.home || !pick.away) return null;
  const mine = exposureOf(pick);
  if (!mine) return null;
  const since = new Date(now.getTime() - 30 * 60_000).toISOString();
  const matchOf = (p: LivePick) => `${(p.home ?? "").toLowerCase()}|${(p.away ?? "").toLowerCase()}`;
  const mineMatch = matchOf(pick);
  const out: string[] = [];
  for (const p of db.listLivePicks(200, { from: since, to: now.toISOString() })) {
    if (p.id === pick.id || matchOf(p) !== mineMatch) continue;
    const kind = clashOf(mine, exposureOf(p));
    if (kind !== "cancels" && kind !== "offsets") continue;
    const minsAgo = Math.round((now.getTime() - Date.parse(p.messageAt ?? p.firstSeenAt)) / 60_000);
    out.push(`${strategyLabel(p.strategy)}'s "${p.detail?.selection ?? p.selection ?? p.market}" alert ${minsAgo} min ago ${kind === "cancels" ? "pointed the opposite way" : "partly disagreed"}.`);
  }
  return out.length > 0 ? out : null;
}

/** Below this many priced picks, this strategy's record in this one league is too thin to show Claude - kept quiet rather than noisy. */
const LEAGUE_RECORD_MIN = 10;

/**
 * This strategy's own record in this one league (league-returns.ts - the same figures the Leagues page's "stop this
 * strategy here" suggestion is built on), not the generic country base rates in leagueHistoricProfile. A strategy
 * can be profitable overall and still have a real weak spot in one league; this is the general, always-current
 * version of what the hand-picked LAY groups already do for a few specific countries. Null below LEAGUE_RECORD_MIN,
 * so Claude is never handed a number too thin to mean anything.
 */
function strategyInLeagueFor(db: EngineDb, pick: LivePick, now: Date): { settledPicks: number; roi: number } | null {
  const id = leagueIdentity(pick.competition, pick.detail?.country ?? null);
  const strategyKey = strategyLabel(pick.strategy).toLowerCase();
  const leagues = cachedReport(db, "claude-league-returns", () => computeLeagueReturns(db) as unknown as Record<string, unknown>, now.getTime(), 10 * 60_000) as unknown as ReturnType<
    typeof computeLeagueReturns
  >;
  const m = leagues.find((l) => l.key === id.key)?.byStrategy[strategyKey]?.all;
  if (!m || m.counted < LEAGUE_RECORD_MIN || m.staked <= 0) return null;
  return { settledPicks: m.counted, roi: Math.round((m.profit / m.staked) * 1000) / 1000 };
}

/**
 * Golden slices (golden.ts) this alert sits in, with their actual status and record - not just the name, which
 * reads the same whether a slice is proven at full stake or still an unproven candidate. Reuses the same cached
 * report the Golden page itself reads (cachedReport's "golden" key), so this rarely costs a fresh computation.
 */
function goldenSlicesFor(db: EngineDb, pick: LivePick, now: Date): Array<{ label: string; status: string; sinceStartRoi: number | null; counted: number }> | null {
  const segs = pickSegments(pick);
  if (segs.length === 0) return null;
  const ids = new Set(segs.map((s) => s.id));
  const strategyKey = strategyLabel(pick.strategy).toLowerCase();
  const report = cachedReport(db, "golden", () => goldenReport(db, now) as unknown as Record<string, unknown>, now.getTime()) as unknown as ReturnType<typeof goldenReport>;
  const mine = report.slices.filter((s) => s.strategyKey === strategyKey && ids.has(s.id));
  return mine.length > 0 ? mine.map((s) => ({ label: s.label, status: s.status, sinceStartRoi: s.slice.all.roi, counted: s.slice.all.counted })) : null;
}

/**
 * The context sent to Claude: the alert itself, plus what the engine already knows around it. Exported so
 * claude-ask.ts (phase 4, "ask about this pick") can reuse exactly the same context-assembly.
 */
export function buildAlertContext(db: EngineDb, pick: LivePick, now = new Date()): Record<string, unknown> {
  const d = pick.detail;
  const strategyKey = strategyLabel(pick.strategy).toLowerCase();
  const form = computeStrategyForm(db)[strategyKey]?.recent ?? null;
  const lays = pick.market ? layGroups(db).filter((g) => g.source === pick.market && g.covers(strategyKey, pickFacts(pick))) : [];
  return {
    strategy: pick.strategy,
    market: pick.market,
    selection: d?.selection ?? pick.selection,
    minute: pick.minute,
    score: pick.goalsHome !== null && pick.goalsAway !== null ? `${pick.goalsHome}-${pick.goalsAway}` : null,
    stats: d?.stats ?? {},
    odds: d?.odds ?? null,
    alertMatchedVolume: d?.matched ?? null,
    // InPlayGuru's own strike rate for this strategy, overall and in this league specifically - a second, independent
    // figure from thisStrategyInThisLeague below (InPlayGuru's whole user base, not just this account's own bets).
    alertStrikeRate: d?.strikeRate ?? null,
    alertStrikeRatePicks: d?.strikeRatePicks ?? null,
    alertStrikeRateInThisLeague: d?.strikeRateLeague ?? null,
    alertStrikeRateInThisLeaguePicks: d?.strikeRateLeaguePicks ?? null,
    competition: pick.competition,
    country: d?.country ?? null,
    strategyRecentForm: form ? { settledPicks: form.all.settled, roi: form.all.roi, currentStreak: form.streak } : null,
    goldenSlicesThisAlertIsIn: goldenSlicesFor(db, pick, now),
    knownLosingPatternsThisAlertMatches: lays.map((g) => g.why),
    marketPriceMovementSinceAlert: priceMovementFor(pick),
    contradictingAlertsOnThisMatch: contradictingAlertsFor(db, pick, now),
    leagueHistoricProfile: leagueProfileFor(d?.country ?? null),
    thisStrategyInThisLeague: strategyInLeagueFor(db, pick, now),
    // Recent form and head-to-head for the two teams (null for a league with no football-data.co.uk file on it -
    // most of what InPlayGuru sends - which is expected, not missing data to guess around).
    recentFormAndHeadToHead: headToHeadFor(pick, now),
    preMatchEdgeValue: preMatchEdgeValueFor(db, pick, now),
    // Current league position for each side, computed from results already on file. Same coverage gap as above.
    leagueTablePosition: tablePositionsFor(pick, now),
    // How its own earlier verdicts turned out once settled (null until a verdict has enough settled picks behind it).
    yourPastVerdictsOnSettledAlerts: describeTrackRecord(trackRecord(db, now), strategyKey),
  };
}

/**
 * How long a note is allowed to run before it's trimmed (truncateNote below). Generous: with max_tokens giving
 * Claude plenty of room (checkAlertWithClaude, claude-golden-review.ts), this is a backstop against a genuinely
 * runaway reply, not the normal case - the Live/Golden pages clamp a long note to a couple of lines with a tap to
 * expand, rather than the engine deciding how much of it is worth keeping.
 */
const NOTE_LIMIT = 2000;

/**
 * Cuts `s` to at most `limit` characters without stopping mid-word: a hard slice chopped a real note off as
 * "...Recent strat" (27 Oct 2026, spotted on the Live tab) instead of a sentence. Backs up to the last space within
 * the limit, and marks a genuine cut with "…" so it reads as unfinished rather than complete.
 */
export function truncateNote(s: string, limit = NOTE_LIMIT): string {
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The give_verdict tool call's input, already parsed JSON from the SDK (not text to re-parse). */
export function parseVerdict(input: unknown): { verdict: "stronger" | "in_line" | "weaker"; confidence: "low" | "medium" | "high"; note: string } | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  const verdict = p.verdict === "stronger" || p.verdict === "weaker" || p.verdict === "in_line" ? p.verdict : null;
  const confidence = p.confidence === "low" || p.confidence === "medium" || p.confidence === "high" ? p.confidence : null;
  const note = typeof p.note === "string" ? truncateNote(p.note.trim()) : null;
  if (!verdict || !confidence || !note) return null;
  return { verdict, confidence, note };
}

/** The key the last failure (if any) is kept under, so the admin page can show it: see lastCheckFailure below. */
const LAST_FAILURE_KEY = "claude_check_last_failure";

/** The last reason a per-alert check failed, and when (null once one has since succeeded), for the admin page. */
export function lastCheckFailure(db: EngineDb): { reason: string; at: string } | null {
  try {
    return JSON.parse(db.getSetting(LAST_FAILURE_KEY) ?? "null") as { reason: string; at: string } | null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget: asks Claude for a second opinion on one alert and stores the answer. Never throws; every
 * failure (no API key, network error, a bad or unusable reply) is caught and logged, leaving the pick with
 * no verdict rather than a wrong one. Callers should call this with `void`, after the pick itself is saved.
 * The reason for the latest failure is kept (lastCheckFailure) so it's visible on the admin page, not only in
 * the engine's own logs: 27 Oct 2026, the owner found no verdicts were landing with nothing to show why.
 */
export async function checkAlertWithClaude(db: EngineDb, pick: LivePick, now = new Date()): Promise<void> {
  const anthropic = getClient();
  if (!anthropic) return;
  const fail = (reason: string) => {
    log.warn(`Claude check for pick ${pick.id}: ${reason}`);
    try {
      db.setSetting(LAST_FAILURE_KEY, JSON.stringify({ reason, at: now.toISOString() }));
    } catch {
      // the verdict itself matters more than remembering why one attempt failed
    }
  };
  try {
    const context = buildAlertContext(db, pick, now);
    const model = isAmbiguous(context) ? AMBIGUOUS_MODEL : MODEL;
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [VERDICT_TOOL],
      tool_choice: { type: "tool", name: VERDICT_TOOL.name },
      messages: [{ role: "user", content: JSON.stringify(context) }],
    });
    const call = response.content.find((b) => b.type === "tool_use" && b.name === VERDICT_TOOL.name);
    const result = call && call.type === "tool_use" ? parseVerdict(call.input) : null;
    if (!result) {
      fail(`couldn't get a usable verdict from its reply (stop reason: ${response.stop_reason ?? "unknown"}).`);
      return;
    }
    db.saveClaudeVerdict(pick.id, { ...result, model }, now.toISOString());
    db.setSetting(LAST_FAILURE_KEY, "null");
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}.`);
  }
}
