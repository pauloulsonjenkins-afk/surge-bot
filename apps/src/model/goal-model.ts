/**
 * RESEARCH (started 2026-10-09): GoalBrew's own goal model.
 *
 * Question: for a "next goal" alert, does a model of InPlayGuru's in-play stats know something the price doesn't?
 * It predicts the chance of another goal before full time from:
 *   - the market's own chance (from the alert's Over/Under prices, the overround taken out), as a starting point;
 *   - the minute, the score (margin and total goals);
 *   - momentum (both sides added, and the gap between them), dangerous attacks and shots on target per minute.
 * So the model only has to learn where the market is wrong, not football from scratch.
 *
 * Honest testing: it is trained on the OLDER 70% of settled picks and judged on the NEWER 30% it never saw, by:
 *   - log loss against the market's (lower = better predictions); the market is the bar to beat;
 *   - betting only where the model's chance is 3+ points above the market's, at the alert's price less 2% commission,
 *     against betting every pick and against the picks it would skip.
 * The prices are the alert's (InPlayGuru's), not what Betfair matched, so treat money figures as a guide.
 * Nothing here bets: it's a report (Results > Goal model). Using it to filter bets would be a later, separate step.
 */
import type { EngineDb } from "../storage/engine-db";
import type { ParsedAlert } from "../inplayguru/parse-alert";

export const FEATURES = [
  "Market's chance (log-odds)",
  "Minute",
  "Goal margin",
  "Goals so far",
  "Momentum, both sides",
  "Momentum gap",
  "Dangerous attacks per minute",
  "Shots on target per 10 min",
] as const;

/** How far above the market's chance the model must be before it would bet (probability points). */
export const EDGE = 0.03;
const COMMISSION = 0.02;

export interface ModelRow {
  at: string;
  x: number[];
  y: 0 | 1;
  /** The market's chance of another goal, overround removed. */
  pMarket: number;
  /** The alert's Over price for the next goal. */
  odds: number;
  strategy: string;
}

/** The features of one next-goal alert, or null when it lacks what's needed (prices, minute). */
export function featuresOf(a: ParsedAlert): { x: number[]; pMarket: number; odds: number } | null {
  const o = a.odds.over;
  const u = a.odds.under;
  const m = a.minute;
  if (!o || !u || o <= 1 || u <= 1 || m === null) return null;
  const gh = a.goalsHome ?? 0;
  const ga = a.goalsAway ?? 0;
  // The alert's Over/Under line should be the next-goal line (goals so far + 0.5).
  if (a.odds.overUnderLine !== null && Math.abs(a.odds.overUnderLine - (gh + ga + 0.5)) > 1e-6) return null;
  const pMarket = 1 / o / (1 / o + 1 / u);
  if (pMarket <= 0.01 || pMarket >= 0.99) return null;
  const stat = (label: string): [number, number] => a.stats[label] ?? [0, 0];
  const mo = stat("Momentum");
  const da = stat("Dangerous Attacks");
  const sot = stat("Shots On Target");
  const mins = Math.max(m, 1);
  return {
    x: [Math.log(pMarket / (1 - pMarket)), m / 90, Math.abs(gh - ga), gh + ga, (mo[0] + mo[1]) / 100, Math.abs(mo[0] - mo[1]) / 100, (da[0] + da[1]) / mins, ((sot[0] + sot[1]) / mins) * 10],
    pMarket,
    odds: o,
  };
}

/** Every settled, counted next-goal pick that has the features, oldest first. */
export function dataset(db: EngineDb): ModelRow[] {
  const out: ModelRow[] = [];
  for (const r of db.listSettledForModel()) {
    if (r.detail.market !== "NEXT_GOAL" || (r.result !== "hit" && r.result !== "miss")) continue;
    const f = featuresOf(r.detail);
    if (!f) continue;
    out.push({ at: r.at, x: f.x, y: r.result === "hit" ? 1 : 0, pMarket: f.pMarket, odds: f.odds, strategy: r.strategy });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// --------------------------------------------------------------------------- logistic regression

export interface Model {
  weights: number[];
  bias: number;
  /** Feature means and spreads from training, to scale new rows the same way. */
  mu: number[];
  sd: number[];
  n: number;
  trainedAt: string;
}

const sigmoid = (t: number) => 1 / (1 + Math.exp(-t));

/** Fits a logistic regression with a little L2 shrinkage (so a few hundred rows can't over-fit wildly). */
export function fit(rows: Array<{ x: number[]; y: number }>, opts: { iterations?: number; rate?: number; l2?: number } = {}): Model {
  const k = rows[0]?.x.length ?? FEATURES.length;
  const n = rows.length;
  const mu = Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r.x[j]!, 0) / Math.max(1, n));
  const sd = Array.from({ length: k }, (_, j) => Math.max(1e-6, Math.sqrt(rows.reduce((s, r) => s + (r.x[j]! - mu[j]!) ** 2, 0) / Math.max(1, n))));
  const z = rows.map((r) => r.x.map((v, j) => (v - mu[j]!) / sd[j]!));
  const w = new Array<number>(k).fill(0);
  let b = 0;
  const rate = opts.rate ?? 0.1;
  const l2 = opts.l2 ?? 0.01;
  for (let it = 0; it < (opts.iterations ?? 1500); it++) {
    const gw = new Array<number>(k).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const zi = z[i]!;
      let t = b;
      for (let j = 0; j < k; j++) t += w[j]! * zi[j]!;
      const e = sigmoid(t) - rows[i]!.y;
      gb += e;
      for (let j = 0; j < k; j++) gw[j]! += e * zi[j]!;
    }
    b -= (rate * gb) / Math.max(1, n);
    for (let j = 0; j < k; j++) w[j] = w[j]! - rate * (gw[j]! / Math.max(1, n) + l2 * w[j]!);
  }
  return { weights: w, bias: b, mu, sd, n, trainedAt: new Date().toISOString() };
}

export function predict(m: Model, x: number[]): number {
  let t = m.bias;
  for (let j = 0; j < m.weights.length; j++) t += m.weights[j]! * ((x[j]! - m.mu[j]!) / m.sd[j]!);
  return sigmoid(t);
}

const logLoss = (ps: number[], ys: number[]) => -ys.reduce((s, y, i) => s + (y ? Math.log(Math.max(ps[i]!, 1e-9)) : Math.log(Math.max(1 - ps[i]!, 1e-9))), 0) / Math.max(1, ys.length);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

function roi(rows: ModelRow[]): { bets: number; roi: number | null } {
  if (rows.length === 0) return { bets: 0, roi: null };
  const profit = rows.reduce((s, r) => s + (r.y ? (r.odds - 1) * (1 - COMMISSION) : -1), 0);
  return { bets: rows.length, roi: r1((100 * profit) / rows.length) };
}

export interface ModelReport {
  rows: number;
  /** Fewer settled picks than this and the test half is too small to say anything. */
  enough: boolean;
  train: { n: number; from: string | null; to: string | null };
  test: {
    n: number;
    from: string | null;
    to: string | null;
    hitRate: number;
    marketChance: number;
    logLossMarket: number;
    logLossModel: number;
    /** Positive = the model predicted better than the market on picks it never saw. */
    improvement: number;
    betEvery: { bets: number; roi: number | null };
    modelBets: { bets: number; roi: number | null };
    modelSkips: { bets: number; roi: number | null };
    calibration: Array<{ band: string; n: number; predicted: number; actual: number }>;
  } | null;
  /** The model trained on everything, as it would be used from now on: which features push the chance up or down. */
  weights: Array<{ feature: string; weight: number }>;
  /** The same check on the older part, to see whether the result holds both ways. */
  trainCheck: { modelBets: { bets: number; roi: number | null }; modelSkips: { bets: number; roi: number | null } } | null;
  verdict: string;
}

const MIN_ROWS = 200;

export function modelReport(db: EngineDb): ModelReport {
  const data = dataset(db);
  const cut = Math.floor(data.length * 0.7);
  const train = data.slice(0, cut);
  const test = data.slice(cut);
  const full = data.length ? fit(data) : null;
  const weights = full ? FEATURES.map((feature, j) => ({ feature, weight: Math.round(full.weights[j]! * 100) / 100 })) : [];
  if (data.length < MIN_ROWS || train.length === 0 || test.length === 0) {
    return {
      rows: data.length,
      enough: false,
      train: { n: train.length, from: train[0]?.at ?? null, to: train.at(-1)?.at ?? null },
      test: null,
      weights,
      trainCheck: null,
      verdict: `Needs at least ${MIN_ROWS} settled next-goal picks with prices to test fairly (has ${data.length}).`,
    };
  }
  const m = fit(train);
  const pTest = test.map((r) => predict(m, r.x));
  const pTrain = train.map((r) => predict(m, r.x));
  const ys = test.map((r) => r.y);
  const llMarket = logLoss(test.map((r) => r.pMarket), ys);
  const llModel = logLoss(pTest, ys);
  const bets = test.filter((r, i) => pTest[i]! > r.pMarket + EDGE);
  const skips = test.filter((r, i) => pTest[i]! <= r.pMarket + EDGE);
  const calibration: Array<{ band: string; n: number; predicted: number; actual: number }> = [];
  for (const [lo, hi] of [
    [0, 0.5],
    [0.5, 0.6],
    [0.6, 0.7],
    [0.7, 0.8],
    [0.8, 1.01],
  ] as const) {
    const idx = pTest.map((p, i) => (p >= lo && p < hi ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) continue;
    calibration.push({
      band: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`,
      n: idx.length,
      predicted: r1((100 * idx.reduce((s, i) => s + pTest[i]!, 0)) / idx.length),
      actual: r1((100 * idx.reduce((s, i) => s + test[i]!.y, 0)) / idx.length),
    });
  }
  const improvement = r4(llMarket - llModel);
  const mb = roi(bets);
  const ms = roi(skips);
  const tb = roi(train.filter((r, i) => pTrain[i]! > r.pMarket + EDGE));
  const ts = roi(train.filter((r, i) => pTrain[i]! <= r.pMarket + EDGE));
  const separates = mb.roi !== null && ms.roi !== null && mb.roi > ms.roi && tb.roi !== null && ts.roi !== null && tb.roi > ts.roi;
  const verdict =
    improvement > 0 && separates
      ? `Promising: on picks it never saw it predicted better than the market, and its picks beat the ones it would skip in both halves. ${test.length} test picks is still small: keep watching before using it to filter bets.`
      : improvement > 0
        ? "Mixed: it predicted slightly better than the market on unseen picks, but its picks didn't beat the skipped ones in both halves."
        : "No edge yet: on unseen picks it didn't predict better than the market. More data, or different features, needed.";
  return {
    rows: data.length,
    enough: true,
    train: { n: train.length, from: train[0]!.at, to: train.at(-1)!.at },
    test: {
      n: test.length,
      from: test[0]!.at,
      to: test.at(-1)!.at,
      hitRate: r1((100 * ys.reduce((s: number, y) => s + y, 0)) / ys.length),
      marketChance: r1((100 * test.reduce((s, r) => s + r.pMarket, 0)) / test.length),
      logLossMarket: r4(llMarket),
      logLossModel: r4(llModel),
      improvement,
      betEvery: roi(test),
      modelBets: mb,
      modelSkips: ms,
      calibration,
    },
    weights,
    trainCheck: { modelBets: tb, modelSkips: ts },
    verdict,
  };
}

let cache: { at: number; report: ModelReport } | null = null;

/** The report, worked out at most every 10 minutes (it trains two models). */
export function cachedModelReport(db: EngineDb, refresh = false): ModelReport {
  if (!refresh && cache && Date.now() - cache.at < 10 * 60_000) return cache.report;
  cache = { at: Date.now(), report: modelReport(db) };
  return cache.report;
}
