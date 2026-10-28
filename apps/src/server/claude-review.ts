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
import { goldenReport } from "./golden";
import { ukDateOf, ukDayBounds } from "./uk-time";
import { ukWeekStart } from "../members/time";
import { truncateNote } from "./claude-check";
import { describeTrackRecord, trackRecord } from "./claude-track-record";
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
  "perAlertVerdictsTrackRecord, when given, is how your own per-alert verdicts have turned out once settled: say in a",
  "sentence whether they are telling winners from losers yet, since that decides whether they deserve trust.",
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

/** Tests only: a stand-in for the Anthropic client (its messages.create), or undefined to go back to the real one. */
export function setReviewClientForTest(c: Pick<Anthropic, "messages"> | undefined): void {
  client = c as Anthropic | undefined;
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
  const out: Array<{ strategy: string; slice: string; nextStage: string; picksAway: number }> = [];
  for (const s of goldenReport(db, now, { skipFinder: true }).slices) {
    if (s.quiet || !s.nextStage || s.nextStage.picksAway > NEAR_NEXT_STAGE) continue;
    out.push({ strategy: s.strategy, slice: s.label, nextStage: s.nextStage.name, picksAway: s.nextStage.picksAway });
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
  return {
    periodFrom: from,
    strategies,
    goldenSlices: golden,
    perAlertVerdictsThisPeriod: verdictTally,
    // How those verdicts have turned out over their whole life, so the review can say whether Claude's own checks are earning their place.
    perAlertVerdictsTrackRecord: describeTrackRecord(trackRecord(db, now), null),
    goldenSlicesCloseToNextStage: goldenCloseToNextStage(db, now),
  };
}

/**
 * Room for the note AND Sonnet 5.5's thinking, which it does by default (adaptive, at high effort) and which counts
 * against max_tokens. At 4000 the 27 Oct 2026 21:30 note never arrived: the likeliest cause is thinking using most of
 * it, leaving a cut-off note that is (rightly) not saved. 16000 is the usual non-streaming size.
 */
const MAX_TOKENS = 16_000;
const ATTEMPTS = 2;

/** One try: the note, or why there isn't one. */
async function tryNote(anthropic: Anthropic, digest: unknown): Promise<{ note: string } | { failed: string }> {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(digest) }],
    });
    if (response.stop_reason === "refusal") return { failed: "Claude declined to write it." };
    // Cut off: never shown, since a note that stops mid-sentence reads as if it were the whole thought.
    if (response.stop_reason === "max_tokens") return { failed: "the reply ran out of room before the note was finished." };
    const note = response.content.find((b) => b.type === "text")?.text.trim();
    return note ? { note } : { failed: "the reply had no text in it." };
  } catch (err) {
    return { failed: `the request failed (${err instanceof Error ? err.message : String(err)}).` };
  }
}

async function writeNote(db: EngineDb, kind: ReviewKind, from: string, now: Date): Promise<void> {
  const anthropic = getClient();
  if (!anthropic) return;
  let digest: unknown;
  try {
    digest = buildDigest(db, from, now);
  } catch (err) {
    recordFailure(db, kind, `GoalBrew couldn't gather the figures (${err instanceof Error ? err.message : String(err)}).`, now);
    return;
  }
  let failed = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const r = await tryNote(anthropic, digest);
    if ("note" in r) {
      const all = loadNotes(db);
      all[kind] = { kind, note: truncateNote(r.note, 3000), generatedAt: now.toISOString() };
      db.setSetting(SETTINGS_KEY, JSON.stringify(all));
      clearFailure(db, kind);
      log.info(`Claude ${kind} review note written (${r.note.length} chars, attempt ${attempt}).`);
      return;
    }
    failed = r.failed;
    log.warn(`Claude ${kind} review attempt ${attempt} of ${ATTEMPTS}: ${failed}`);
  }
  recordFailure(db, kind, failed, now);
}

// --------------------------------------------------------------------------- failures, for the Today page

const FAILURE_KEY = "claude_review_last_failure";

/** Why the latest note of a kind didn't arrive: until 28 Oct 2026 this only went to the log, so Today quietly kept
 * showing the previous day's note as "Today" with nothing saying the new one had failed. */
export interface ClaudeReviewFailure {
  kind: ReviewKind;
  reason: string;
  at: string;
}

function loadFailures(db: EngineDb): Partial<Record<ReviewKind, ClaudeReviewFailure>> {
  try {
    return JSON.parse(db.getSetting(FAILURE_KEY) ?? "{}") as Partial<Record<ReviewKind, ClaudeReviewFailure>>;
  } catch {
    return {};
  }
}

function recordFailure(db: EngineDb, kind: ReviewKind, reason: string, now: Date): void {
  const all = loadFailures(db);
  all[kind] = { kind, reason, at: now.toISOString() };
  db.setSetting(FAILURE_KEY, JSON.stringify(all));
  log.warn(`Claude ${kind} review not written: ${reason}`);
}

function clearFailure(db: EngineDb, kind: ReviewKind): void {
  const all = loadFailures(db);
  if (!all[kind]) return;
  delete all[kind];
  db.setSetting(FAILURE_KEY, JSON.stringify(all));
}

/** The latest failure of each kind not yet followed by a successful note. */
export function getClaudeReviewFailures(db: EngineDb): Partial<Record<ReviewKind, ClaudeReviewFailure>> {
  return loadFailures(db);
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
export function requestDailyClaudeReview(db: EngineDb, now = new Date()): Promise<void> {
  const { from } = ukDayBounds(ukDateOf(now));
  return writeNote(db, "daily", from, now);
}

/** Called once the weekly review is due (weekly-review.ts) — fire-and-forget, never delays the push. */
export function requestWeeklyClaudeReview(db: EngineDb, now = new Date()): Promise<void> {
  const from = ukDayBounds(ukWeekStart(ukDateOf(now))).from;
  return writeNote(db, "weekly", from, now);
}
