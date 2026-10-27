/**
 * Claude's daily / weekly review (design in docs/claude-in-goalbrew.md, phase 2).
 *
 * ADVISORY ONLY, same boundary as claude-check.ts: this never writes to SendingSettings, never calls buildFeed or
 * direct betting, and never changes a strategy's Live switch, a Golden slice's betting, or a LAY group's stake. It
 * hands Claude a read-only digest (the day's or week's figures, already computed by winloss.ts/golden.ts, plus a
 * tally of its own per-alert verdicts from claude-check.ts) and asks for a short written note, which is stored for
 * the admin to read on the Today / admin pages. The note is text to read: it may name an idea worth looking at
 * (try X Live, narrow Y around a losing pattern), but it is never a setting the admin's answer changes — nothing
 * downstream of this file acts on what it says.
 *
 * Runs on the same schedule as the existing push notifications (daily-summary.ts, weekly-review.ts) and shares
 * their "has this slot already been sent" bookkeeping, but writes its own note instead of sending a push, so a
 * missing or slow Claude reply never delays or blocks the push the owner already relies on.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EngineDb } from "../storage/engine-db";
import { computeStrategyReturns } from "./winloss";
import { getSendingSettings } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { CANDIDATE_FROM, FULL_FROM, goldenReport, TRIAL_FROM } from "./golden";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { ukWeekStart } from "../members/time";
import { truncateNote } from "./claude-check";
import { log } from "./log";

const MODEL = "claude-sonnet-5-5";
const SETTINGS_KEY = "claude_review_notes";

export type ReviewKind = "daily" | "weekly";

export interface ClaudeReviewNote {
  kind: ReviewKind;
  note: string;
  generatedAt: string;
}

const SYSTEM_PROMPT = [
  "You write a short note for the owner of GoalBrew, a football in-play betting assistant, summarising a period's",
  "results. You never place or skip a bet yourself, and nothing you write changes any setting on its own — the owner",
  "reads this and decides. Note what is drifting, which strategies or Golden slices look shaky or are proving",
  "themselves, and whether a stop-loss trip or a badge change looks like a blip or a pattern. Then, where the data",
  "actually supports it, name one or two concrete things worth the owner's attention: a strategy or slice that looks",
  "ready to try Live or ready to come off it, a LAY group candidate, a losing pattern worth narrowing a strategy",
  "around. Only raise an idea the figures given actually back up — say plainly when nothing stands out rather than",
  "inventing one.",
  "Finish with one line on what's worth watching next, from goldenSlicesCloseToNextStage (how many picks a slice is",
  "from becoming a candidate, a Live trial or full stake) if anything is given there — e.g. 'X is 6 picks from a Live",
  "trial'. This is never a results forecast: you cannot and must not predict tomorrow's results or say a strategy",
  "will do well. If the list is empty, skip this line rather than inventing something to watch.",
  "3-7 sentences, plain and concrete, no hedging filler, no bullet points.",
].join(" ");

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

export function claudeReviewConfigured(): boolean {
  return getClient() !== null;
}

/** Within this many priced picks of its next Golden stage, a watched slice is worth flagging as close. */
const NEAR_NEXT_STAGE = 15;

/**
 * Watched slices close to their next Golden stage (golden.ts's own thresholds), for the review's forward-looking
 * line: not a results forecast (nothing here predicts what happens, only how close a slice is to a stage change
 * that's already mechanical and rule-based), just what's worth watching for tomorrow.
 */
export function goldenCloseToNextStage(db: EngineDb, now: Date): Array<{ strategy: string; slice: string; nextStage: string; picksAway: number }> {
  const nextStageFor: Partial<Record<string, { threshold: number; name: string }>> = {
    quiet: { threshold: CANDIDATE_FROM, name: "a candidate" },
    candidate: { threshold: TRIAL_FROM, name: "a Live trial" },
    trial: { threshold: FULL_FROM, name: "full stake" },
  };
  const out: Array<{ strategy: string; slice: string; nextStage: string; picksAway: number }> = [];
  for (const s of goldenReport(db, now, { skipFinder: true }).slices) {
    if (s.quiet) continue;
    const next = nextStageFor[s.status];
    if (!next) continue;
    const picksAway = next.threshold - s.slice.all.counted;
    if (picksAway > 0 && picksAway <= NEAR_NEXT_STAGE) out.push({ strategy: s.strategy, slice: s.label, nextStage: next.name, picksAway });
  }
  return out;
}

/** The read-only digest handed to Claude: nothing here is a setting, only figures already shown elsewhere. */
function buildDigest(db: EngineDb, from: string, now: Date): Record<string, unknown> {
  const returns = computeStrategyReturns(db, from);
  const settings = getSendingSettings(db);
  const strategies = Object.entries(returns).map(([key, r]) => ({
    name: displayName(db, key),
    live: settings.strategies[key] === true,
    liveSettled: r.live.settled,
    liveRoi: r.live.roi,
    simSettled: r.sim.settled,
    simRoi: r.sim.roi,
    longestLosingRun: r.live.settled > 0 ? r.live.longestLosingRun : r.sim.longestLosingRun,
  }));
  const golden = goldenReport(db, now, { skipFinder: true }).slices.map((s) => ({
    strategy: s.strategy,
    label: s.label,
    status: s.status,
    why: s.why,
  }));
  // How often Claude's own per-alert check (claude-check.ts) flagged something weaker this period, for a sanity
  // cross-check in the review ("does the written note agree with what the per-alert checks already flagged").
  const verdictTally = db.sqlite
    .prepare(`SELECT verdict, COUNT(*) as n FROM claude_verdicts WHERE checked_at >= ? GROUP BY verdict`)
    .all(from) as Array<{ verdict: string; n: number }>;
  return { periodFrom: from, strategies, goldenSlices: golden, perAlertVerdictsThisPeriod: verdictTally, goldenSlicesCloseToNextStage: goldenCloseToNextStage(db, now) };
}

async function writeNote(db: EngineDb, kind: ReviewKind, from: string, now: Date): Promise<void> {
  const anthropic = getClient();
  if (!anthropic) return;
  try {
    const digest = buildDigest(db, from, now);
    // Plenty of room: Sonnet thinks before it writes, and that thinking counts against max_tokens. At 600 the note
    // was regularly stopping mid-sentence (seen on Today, 27 Oct 2026: "...matched odds home (39 settled, +17.4").
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(digest) }],
    });
    const note = response.content.find((b) => b.type === "text")?.text.trim();
    if (!note) {
      log.warn(`Claude ${kind} review: no text in the reply.`);
      return;
    }
    // Still cut off: keep the previous note rather than show one that stops mid-sentence.
    if (response.stop_reason === "max_tokens") {
      log.warn(`Claude ${kind} review: cut off by max_tokens, not saved.`);
      return;
    }
    const all = loadNotes(db);
    all[kind] = { kind, note: truncateNote(note, 3000), generatedAt: now.toISOString() };
    db.setSetting(SETTINGS_KEY, JSON.stringify(all));
    log.info(`Claude ${kind} review note written (${note.length} chars).`);
  } catch (err) {
    log.warn(`Claude ${kind} review failed: ${err instanceof Error ? err.message : String(err)}.`);
  }
}

function loadNotes(db: EngineDb): Partial<Record<ReviewKind, ClaudeReviewNote>> {
  try {
    return JSON.parse(db.getSetting(SETTINGS_KEY) ?? "{}") as Partial<Record<ReviewKind, ClaudeReviewNote>>;
  } catch {
    return {};
  }
}

/** The latest stored note of each kind, for the admin page. Null for a kind that hasn't run yet, or has no API key. */
export function getClaudeReviewNotes(db: EngineDb): Partial<Record<ReviewKind, ClaudeReviewNote>> {
  return loadNotes(db);
}

/** Called once a day's summary is due (daily-summary.ts) — fire-and-forget, never delays the push. */
export function requestDailyClaudeReview(db: EngineDb, now = new Date()): void {
  const { from } = ukDayBounds(ukDateOf(now));
  void writeNote(db, "daily", from, now);
}

/** Called once the weekly review is due (weekly-review.ts) — fire-and-forget, never delays the push. */
export function requestWeeklyClaudeReview(db: EngineDb, now = new Date()): void {
  const from = ukDayBounds(ukWeekStart(ukDateOf(now))).from;
  void writeNote(db, "weekly", from, now);
}
