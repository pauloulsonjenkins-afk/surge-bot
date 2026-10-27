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
import type { EngineDb, LivePick } from "../storage/engine-db";
import { pickFacts, pickSegments, strategyLabel } from "../inplayguru/bet-feed";
import { layGroups } from "../inplayguru/lay-groups";
import { computeStrategyForm } from "./winloss";
import { historyMatches, leagueProfiles, tablePositions } from "../history/football-data";
import { edgeCard } from "../edge/edge";
import { log } from "./log";

/** Cheap by design (see docs/claude-in-goalbrew.md § 3): a bounded classification call, not a chat. */
const MODEL = "claude-haiku-5-5";

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
    alertStrikeRate: d?.strikeRate ?? null,
    competition: pick.competition,
    country: d?.country ?? null,
    strategyRecentForm: form ? { settledPicks: form.all.settled, roi: form.all.roi, currentStreak: form.streak } : null,
    goldenSlicesThisAlertIsIn: pickSegments(pick).map((s) => s.label),
    knownLosingPatternsThisAlertMatches: lays.map((g) => g.why),
    leagueHistoricProfile: leagueProfileFor(d?.country ?? null),
    // Recent form and head-to-head for the two teams (null for a league with no football-data.co.uk file on it -
    // most of what InPlayGuru sends - which is expected, not missing data to guess around).
    recentFormAndHeadToHead: headToHeadFor(pick, now),
    // Current league position for each side, computed from results already on file. Same coverage gap as above.
    leagueTablePosition: tablePositionsFor(pick, now),
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
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
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
    db.saveClaudeVerdict(pick.id, { ...result, model: MODEL }, now.toISOString());
    db.setSetting(LAST_FAILURE_KEY, "null");
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}.`);
  }
}
