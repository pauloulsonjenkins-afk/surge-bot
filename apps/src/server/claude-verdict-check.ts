/**
 * The Claude verdict check: once enough of Claude's per-alert verdicts (claude-check.ts) have settled, compares
 * their results — picks, hit rate, return per £1, at the same prices the Strategies page uses (winloss.ts's own
 * pricing, so the two pages always agree) — grouped by verdict (stronger / in line / weaker). Below the threshold
 * it just says how many of the threshold have settled so far.
 *
 * Advisory only, same as every other Claude file here: this reads results, it never changes a bet or a setting
 * other than its own shadow-mode flag below.
 *
 * SHADOW MODE: the per-alert badge (shown on the Live tab, see http.ts's /internal/live) starts hidden — Claude's
 * verdicts are stored and this check can be read, but nothing is shown to the admin while placing a bet, until the
 * admin turns it on here. The idea (and the call) is the owner's: don't show a warning badge until this check has
 * shown that "weaker" verdicts actually predict worse results than "in line" ones.
 */
import type { EngineDb } from "../storage/engine-db";
import { claudeCheckPaused, claudeConfigured, lastCheckFailure } from "./claude-check";
import { computeVerdictTrackRecord, type Verdict, type VerdictRow } from "./claude-track-record";

const VERDICT_THRESHOLD = 100;
const BADGE_VISIBLE_KEY = "claude_badge_visible";

export interface ClaudeVerdictCheck {
  settledCount: number;
  threshold: number;
  ready: boolean;
  byVerdict: Record<Verdict, VerdictRow>;
  /** Plain-language verdict on the verdicts: whether "weaker" has actually done worse than "in line". Null until ready. */
  summary: string;
  badgeVisible: boolean;
  /** The per-alert check is paused: no calls, no new verdicts (claude-check.ts). */
  paused: boolean;
  /** "In line" verdicts are left off the Live tab. */
  hideInLine: boolean;
  /** Whether the engine has an API key to call Claude with at all (added 27 Oct 2026: if not, nothing below runs). */
  configured: boolean;
  /** Why the last per-alert check failed, and when, if one has since another succeeded (claude-check.ts). */
  lastFailure: { reason: string; at: string } | null;
}

export function computeClaudeVerdictCheck(db: EngineDb): ClaudeVerdictCheck {
  // The figures themselves live in claude-track-record.ts: the same ones are handed back to Claude as its own record.
  const { overall: byVerdict, settledCount } = computeVerdictTrackRecord(db);
  const ready = settledCount >= VERDICT_THRESHOLD;
  const summary = !ready ? `${settledCount} of ${VERDICT_THRESHOLD} settled.` : verdictSummary(byVerdict);
  return { settledCount, threshold: VERDICT_THRESHOLD, ready, byVerdict, summary, badgeVisible: claudeBadgeVisible(db), paused: claudeCheckPaused(db), hideInLine: claudeHideInLine(db), configured: claudeConfigured(), lastFailure: claudeCheckPaused(db) ? null : lastCheckFailure(db) };
  // (lastFailure: while paused nothing is called, so an old failure would stay on show for good, reading as a live problem.)
}

/** A margin worth calling real, not noise: "weaker" needs to return at least this much worse per £1 than "in line". */
const MEANINGFUL_ROI_GAP = 0.03;

function verdictSummary(byVerdict: Record<Verdict, VerdictRow>): string {
  const weaker = byVerdict.weaker;
  const inLine = byVerdict.in_line;
  if (weaker.roi === null || inLine.roi === null || weaker.n < 20) {
    return "Not enough priced \"weaker\" picks yet to tell whether Claude's warnings are telling you anything.";
  }
  const gap = inLine.roi - weaker.roi;
  if (gap >= MEANINGFUL_ROI_GAP) {
    return `Claude's warnings are telling you something: alerts it flagged weaker returned ${pct(weaker.roi)} per £1, against ${pct(inLine.roi)} for alerts it called in line — a real gap.`;
  }
  return `Claude's warnings aren't telling you much yet: alerts it flagged weaker returned ${pct(weaker.roi)} per £1, against ${pct(inLine.roi)} for in line — not a meaningful gap.`;
}

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;
}

const HIDE_IN_LINE_KEY = "claude_hide_in_line";

/**
 * Whether "in line" verdicts are left off the Live tab, so only "stronger" and "weaker" show (the owner's choice, 29 Oct
 * 2026: in line says nothing new). Display only: the call is the same either way, since the verdict isn't known until
 * Claude has answered. On by default.
 */
export function claudeHideInLine(db: EngineDb): boolean {
  return db.getSetting(HIDE_IN_LINE_KEY) !== "false";
}

export function setClaudeHideInLine(db: EngineDb, hide: boolean): void {
  db.setSetting(HIDE_IN_LINE_KEY, hide ? "true" : "false");
}

/** Whether the per-alert verdict badge is shown on the Live tab. Off (shadow mode) until the admin turns it on. */
export function claudeBadgeVisible(db: EngineDb): boolean {
  return db.getSetting(BADGE_VISIBLE_KEY) === "true";
}

export function setClaudeBadgeVisible(db: EngineDb, visible: boolean): void {
  db.setSetting(BADGE_VISIBLE_KEY, visible ? "true" : "false");
}
