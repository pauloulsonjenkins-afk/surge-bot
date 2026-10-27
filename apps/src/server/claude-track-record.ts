/**
 * How Claude's own per-alert verdicts (claude-check.ts) actually turned out once the picks settled: for each verdict
 * (stronger / in line / weaker), how many, how many won, and the return per £1 at the Strategies page's own pricing.
 * Worked out overall and per strategy.
 *
 * Two uses, one source of truth: the Claude verdict check page shows the overall figures, and the per-alert check and
 * the daily review are handed them so Claude can calibrate against its own record (27 Oct 2026, the owner's "feedback
 * loop"). Claude itself doesn't change between calls; what changes is that it is shown whether its earlier verdicts
 * separated winners from losers, and told to be more cautious when they haven't.
 */
import type { EngineDb } from "../storage/engine-db";
import { pricingInputs, ALL_TIME, type ResultRow } from "./winloss";
import { cachedReport } from "./report-cache";

export type Verdict = "stronger" | "in_line" | "weaker";
const VERDICTS: readonly Verdict[] = ["stronger", "in_line", "weaker"];

export interface VerdictRow {
  n: number;
  hits: number;
  hitRate: number | null;
  /** Of `n`, how many could be priced (stake and odds known) - only these count toward `roi`. */
  counted: number;
  roi: number | null;
}

type ByVerdict = Record<Verdict, VerdictRow>;

export interface TrackRecord {
  overall: ByVerdict;
  settledCount: number;
  byStrategy: Record<string, ByVerdict>;
}

/** Below this many settled picks behind a verdict, its figures aren't shown to Claude (too few to mean anything). */
export const TRACK_RECORD_MIN = 10;

const tally = () => ({ n: 0, hits: 0, staked: 0, profit: 0, counted: 0 });
type Tally = ReturnType<typeof tally>;
const fresh = (): Record<Verdict, Tally> => ({ stronger: tally(), in_line: tally(), weaker: tally() });

function toRows(t: Record<Verdict, Tally>): ByVerdict {
  const out = {} as ByVerdict;
  for (const v of VERDICTS) {
    const x = t[v];
    out[v] = {
      n: x.n,
      hits: x.hits,
      hitRate: x.n > 0 ? Math.round((x.hits / x.n) * 1000) / 10 : null,
      counted: x.counted,
      roi: x.staked > 0 ? Math.round((x.profit / x.staked) * 1000) / 1000 : null,
    };
  }
  return out;
}

export function computeVerdictTrackRecord(db: EngineDb): TrackRecord {
  const { price } = pricingInputs(db);
  const rows: ResultRow[] = db.listResultsForWinLoss(ALL_TIME);
  const verdicts = db.getClaudeVerdicts(rows.map((r) => r.id));
  const overall = fresh();
  const perStrategy = new Map<string, Record<Verdict, Tally>>();
  let settledCount = 0;
  for (const r of rows) {
    const v = verdicts.get(r.id);
    if (!v) continue;
    settledCount++;
    const { key, priced } = price(r);
    let mine = perStrategy.get(key);
    if (!mine) perStrategy.set(key, (mine = fresh()));
    for (const t of [overall[v.verdict], mine[v.verdict]]) {
      t.n++;
      if (r.result === "hit") t.hits++;
      if (priced.kind === "priced") {
        t.counted++;
        t.staked += priced.stake;
        t.profit += priced.profit;
      }
    }
  }
  return { overall: toRows(overall), settledCount, byStrategy: Object.fromEntries([...perStrategy].map(([k, t]) => [k, toRows(t)])) };
}

/** The same figures, reused for up to ten minutes (a check fires per alert; reading every settled pick each time would be wasteful). */
export function trackRecord(db: EngineDb, now = new Date()): TrackRecord {
  return cachedReport(db, "claude-track-record", () => computeVerdictTrackRecord(db) as unknown as Record<string, unknown>, now.getTime(), 10 * 60_000) as unknown as TrackRecord;
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;

function describeRows(rows: ByVerdict): Record<string, unknown> | null {
  const shown = VERDICTS.filter((v) => rows[v].n >= TRACK_RECORD_MIN);
  if (shown.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (const v of shown) out[v] = { settled: rows[v].n, hitRate: rows[v].hitRate === null ? null : `${rows[v].hitRate}%`, returnPerPound: rows[v].roi === null ? null : pct(rows[v].roi) };
  const s = rows.stronger;
  const w = rows.weaker;
  if (s.n >= TRACK_RECORD_MIN && w.n >= TRACK_RECORD_MIN && s.hitRate !== null && w.hitRate !== null) {
    const gap = Math.round((s.hitRate - w.hitRate) * 10) / 10;
    out.separation =
      Math.abs(gap) < 3
        ? `"stronger" and "weaker" verdicts have won about the same share (${s.hitRate}% vs ${w.hitRate}%): so far the verdicts aren't telling winners from losers`
        : gap > 0
          ? `"stronger" verdicts have won ${gap} points more often than "weaker" ones (${s.hitRate}% vs ${w.hitRate}%): the verdicts are helping`
          : `"weaker" verdicts have won ${-gap} points MORE often than "stronger" ones (${w.hitRate}% vs ${s.hitRate}%): the verdicts have been pointing the wrong way`;
  }
  return out;
}

/**
 * What Claude is shown about its own record, or null until at least one verdict has TRACK_RECORD_MIN settled picks:
 * the overall figures, and this strategy's own when it has enough of its own.
 */
export function describeTrackRecord(rec: TrackRecord, strategyKey: string | null): Record<string, unknown> | null {
  const overall = describeRows(rec.overall);
  const mine = strategyKey ? describeRows(rec.byStrategy[strategyKey] ?? toRows(fresh())) : null;
  if (!overall && !mine) return null;
  return { acrossAllStrategies: overall, onThisStrategy: mine };
}
