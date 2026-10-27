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
import { pricingInputs, ALL_TIME, type ResultRow } from "./winloss";
import { claudeConfigured, lastCheckFailure } from "./claude-check";

const VERDICT_THRESHOLD = 100;
const BADGE_VISIBLE_KEY = "claude_badge_visible";

type Verdict = "stronger" | "in_line" | "weaker";

interface VerdictRow {
  n: number;
  hits: number;
  hitRate: number | null;
  /** Of `n`, how many could be priced (stake and odds known) — only these count toward `roi`. */
  counted: number;
  roi: number | null;
}

export interface ClaudeVerdictCheck {
  settledCount: number;
  threshold: number;
  ready: boolean;
  byVerdict: Record<Verdict, VerdictRow>;
  /** Plain-language verdict on the verdicts: whether "weaker" has actually done worse than "in line". Null until ready. */
  summary: string;
  badgeVisible: boolean;
  /** Whether the engine has an API key to call Claude with at all (added 27 Oct 2026: if not, nothing below runs). */
  configured: boolean;
  /** Why the last per-alert check failed, and when, if one has since another succeeded (claude-check.ts). */
  lastFailure: { reason: string; at: string } | null;
}

function emptyRow(): { n: number; hits: number; staked: number; profit: number; counted: number } {
  return { n: 0, hits: 0, staked: 0, profit: 0, counted: 0 };
}

export function computeClaudeVerdictCheck(db: EngineDb): ClaudeVerdictCheck {
  const { price } = pricingInputs(db);
  const rows: ResultRow[] = db.listResultsForWinLoss(ALL_TIME);
  const ids = rows.map((r) => r.id);
  const verdicts = db.getClaudeVerdicts(ids);
  const tally: Record<Verdict, ReturnType<typeof emptyRow>> = { stronger: emptyRow(), in_line: emptyRow(), weaker: emptyRow() };
  let settledCount = 0;
  for (const r of rows) {
    const v = verdicts.get(r.id);
    if (!v) continue;
    settledCount++;
    const t = tally[v.verdict];
    t.n++;
    if (r.result === "hit") t.hits++;
    const { priced } = price(r);
    if (priced.kind === "priced") {
      t.counted++;
      t.staked += priced.stake;
      t.profit += priced.profit;
    }
  }
  const byVerdict: Record<Verdict, VerdictRow> = {} as Record<Verdict, VerdictRow>;
  for (const key of ["stronger", "in_line", "weaker"] as const) {
    const t = tally[key];
    byVerdict[key] = {
      n: t.n,
      hits: t.hits,
      hitRate: t.n > 0 ? Math.round((t.hits / t.n) * 1000) / 10 : null,
      counted: t.counted,
      roi: t.staked > 0 ? Math.round((t.profit / t.staked) * 1000) / 1000 : null,
    };
  }
  const ready = settledCount >= VERDICT_THRESHOLD;
  const summary = !ready
    ? `${settledCount} of ${VERDICT_THRESHOLD} settled.`
    : verdictSummary(byVerdict);
  return { settledCount, threshold: VERDICT_THRESHOLD, ready, byVerdict, summary, badgeVisible: claudeBadgeVisible(db), configured: claudeConfigured(), lastFailure: lastCheckFailure(db) };
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

/** Whether the per-alert verdict badge is shown on the Live tab. Off (shadow mode) until the admin turns it on. */
export function claudeBadgeVisible(db: EngineDb): boolean {
  return db.getSetting(BADGE_VISIBLE_KEY) === "true";
}

export function setClaudeBadgeVisible(db: EngineDb, visible: boolean): void {
  db.setSetting(BADGE_VISIBLE_KEY, visible ? "true" : "false");
}
