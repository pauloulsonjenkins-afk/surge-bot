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
import { leagueProfiles } from "../history/football-data";
import { log } from "./log";

/** Cheap by design (see docs/claude-in-goalbrew.md § 3): a bounded classification call, not a chat. */
const MODEL = "claude-haiku-5-5";

const SYSTEM_PROMPT = [
  "You are a second opinion on in-play football betting alerts for GoalBrew, a betting assistant.",
  "You never place, skip, or recommend placing a bet. You only judge whether THIS one alert looks stronger, in",
  "line with, or weaker than its strategy's own usual pattern, using only the data given.",
  "If the data given doesn't support a confident view, answer in_line with low confidence rather than guessing.",
  "Reply with ONLY a single JSON object, no other text, matching exactly:",
  '{"verdict": "stronger" | "in_line" | "weaker", "confidence": "low" | "medium" | "high", "note": "<1-3 sentences, concrete, no filler>"}',
].join(" ");

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
 * The context sent to Claude: the alert itself, plus what the engine already knows around it. Exported so
 * claude-ask.ts (phase 4, "ask about this pick") can reuse exactly the same context-assembly.
 */
export function buildAlertContext(db: EngineDb, pick: LivePick): Record<string, unknown> {
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
  };
}

function parseVerdict(text: string): { verdict: "stronger" | "in_line" | "weaker"; confidence: "low" | "medium" | "high"; note: string } | null {
  let parsed: unknown;
  try {
    // Claude is told to answer with only JSON, but strip any stray code-fence wrapping defensively.
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const verdict = p.verdict === "stronger" || p.verdict === "weaker" || p.verdict === "in_line" ? p.verdict : null;
  const confidence = p.confidence === "low" || p.confidence === "medium" || p.confidence === "high" ? p.confidence : null;
  const note = typeof p.note === "string" ? p.note.trim().slice(0, 600) : null;
  if (!verdict || !confidence || !note) return null;
  return { verdict, confidence, note };
}

/**
 * Fire-and-forget: asks Claude for a second opinion on one alert and stores the answer. Never throws; every
 * failure (no API key, network error, a bad or unparseable reply) is caught and logged, leaving the pick with
 * no verdict rather than a wrong one. Callers should call this with `void`, after the pick itself is saved.
 */
export async function checkAlertWithClaude(db: EngineDb, pick: LivePick, now = new Date()): Promise<void> {
  const anthropic = getClient();
  if (!anthropic) return;
  try {
    const context = buildAlertContext(db, pick);
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const result = parseVerdict(text);
    if (!result) {
      log.warn(`Claude check for pick ${pick.id}: couldn't parse a verdict from its reply.`);
      return;
    }
    db.saveClaudeVerdict(pick.id, { ...result, model: MODEL }, now.toISOString());
  } catch (err) {
    log.warn(`Claude check for pick ${pick.id} failed: ${err instanceof Error ? err.message : String(err)}.`);
  }
}
