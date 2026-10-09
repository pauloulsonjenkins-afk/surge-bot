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
 *
 * SHADOW (from 2026-10-09): a frozen model version scores every new next-goal pick as it arrives, against Betfair's
 * price for the bet when the engine has read it (the alert's price otherwise). "Would bet" = the model's chance is 3+
 * points above the chance that price needs to break even after 2% commission. Picks are only labelled, never held
 * back or bet differently. Once they settle, the two groups are compared (shadowReport): a fair test, as the model
 * never saw them. The model is retrained on everything each week and frozen as a new version, so every scored pick
 * ties to the version that scored it.
 */
import type { EngineDb } from "../storage/engine-db";
import type { ParsedAlert } from "../inplayguru/parse-alert";
import { sendPush } from "../server/push";
import { log } from "../server/log";

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

// --------------------------------------------------------------------------- shadow: the frozen model, scoring live

const ACTIVE_KEY = "goal_model_active";
const RETRAIN_EVERY_MS = 7 * 86_400_000;

export interface ActiveModel extends Model {
  version: string;
}

export function getActiveModel(db: EngineDb): ActiveModel | null {
  try {
    const raw = db.getSetting(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ActiveModel) : null;
  } catch {
    return null;
  }
}

/** Trains on every settled pick and freezes it as the next version. Null when there isn't enough data yet. */
export function publishModel(db: EngineDb, now = new Date()): ActiveModel | null {
  const data = dataset(db);
  if (data.length < MIN_ROWS) return null;
  const prev = getActiveModel(db);
  const n = prev ? Number(/^v(\d+)/.exec(prev.version)?.[1] ?? 0) + 1 : 1;
  const model: ActiveModel = { ...fit(data), trainedAt: now.toISOString(), version: `v${n} (${now.toISOString().slice(0, 10)})` };
  db.setSetting(ACTIVE_KEY, JSON.stringify(model));
  cache = null;
  return model;
}

/** The chance a price needs to break even after commission: 1 / (1 + (price - 1) x (1 - commission)). */
export function breakEven(price: number): number {
  return 1 / (1 + (price - 1) * (1 - COMMISSION));
}

/**
 * Scores one next-goal pick with the active model, or returns null when it can't yet: no model, the alert lacks the
 * features, or Betfair hasn't been checked and the pick is under 2 minutes old (its price is worth waiting for).
 */
export function scorePick(
  model: ActiveModel,
  p: { detail: ParsedAlert | null; exchange: string | null; exchangeOdds: number | null; firstSeenAt: string },
  now = new Date(),
  opts: { noWait?: boolean } = {},
) {
  if (!p.detail) return null;
  const f = featuresOf(p.detail);
  if (!f) return null;
  const waited = opts.noWait === true || now.getTime() - Date.parse(p.firstSeenAt) > 2 * 60_000;
  if (p.exchange === null && !waited) return null;
  const betfair = p.exchange === "on" && p.exchangeOdds !== null && p.exchangeOdds > 1;
  const price = betfair ? p.exchangeOdds! : f.odds;
  const pModel = predict(model, f.x);
  const pNeeded = breakEven(price);
  return { pModel, pMarket: f.pMarket, price, priceFrom: betfair ? "betfair" : "alert", pNeeded, edge: pModel - pNeeded };
}

/** One pass: retrain weekly, then score any new next-goal picks. Returns how many were scored. */
export function shadowTick(db: EngineDb, now = new Date()): number {
  let model = getActiveModel(db);
  if (!model || now.getTime() - Date.parse(model.trainedAt) > RETRAIN_EVERY_MS) model = publishModel(db, now) ?? model;
  if (!model) return 0;
  let scored = 0;
  for (const p of db.unscoredForModel(new Date(now.getTime() - 86_400_000).toISOString())) {
    const s = scorePick(model, p, now);
    if (!s) continue;
    db.saveModelScore({ pickId: p.id, version: model.version, ...s, at: now.toISOString() });
    scored++;
  }
  return scored;
}

/**
 * The MODEL FILTER's answer for one pick of a strategy that has it switched on (Sending: modelFilter): bet or hold
 * back. Uses the pick's shadow score when it has one, so the filter and the shadow figures always agree; otherwise
 * scores it now (with whatever price is known) and saves that. Null when the model can't judge it (no model yet, or
 * the alert lacks the figures): the pick then goes ahead as if the filter were off.
 */
export function modelVerdict(
  db: EngineDb,
  p: { id: number; market: string | null; detail: ParsedAlert | null; exchange: string | null; exchangeOdds: number | null; firstSeenAt: string },
  now = new Date(),
): { bet: boolean; reason: string } | null {
  if (p.market !== "NEXT_GOAL") return null;
  let s = db.getModelScore(p.id);
  if (!s) {
    const model = getActiveModel(db);
    if (!model) return null;
    const fresh = scorePick(model, p, now, { noWait: true });
    if (!fresh) return null;
    db.saveModelScore({ pickId: p.id, version: model.version, ...fresh, at: now.toISOString() });
    s = { version: model.version, ...fresh };
  }
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  return s.edge >= EDGE
    ? { bet: true, reason: `Model ${pct(s.pModel)} vs ${pct(s.pNeeded)} needed at ${s.price.toFixed(2)}.` }
    : { bet: false, reason: `Model sees no edge: ${pct(s.pModel)} chance of a goal, ${pct(s.pNeeded)} needed at ${s.price.toFixed(2)} (wants ${Math.round(EDGE * 100)}+ points more).` };
}

export interface ShadowGroup {
  picks: number;
  settled: number;
  hitRate: number | null;
  /** Profit per £1 at the price scored (Betfair's when known), less 2% commission. */
  roi: number | null;
}

export interface ShadowReport {
  model: { version: string; trainedAt: string; rows: number } | null;
  since: string | null;
  scored: number;
  /** Share scored against Betfair's price (the rest used the alert's). */
  betfairShare: number | null;
  wouldBet: ShadowGroup;
  wouldSkip: ShadowGroup;
  byStrategy: Array<{ strategy: string; wouldBet: ShadowGroup; wouldSkip: ShadowGroup }>;
  recent: Array<{ pickId: number; strategy: string; match: string; minute: number | null; pModel: number; pNeeded: number; price: number; priceFrom: string; wouldBet: boolean; result: string | null }>;
  /** The written rule for turning the filter on, and whether it's met. */
  ready: { met: boolean; reasons: string[] };
}

function group(rows: Array<{ result: string | null; price: number }>): ShadowGroup {
  const settled = rows.filter((r) => r.result === "hit" || r.result === "miss");
  const profit = settled.reduce((s, r) => s + (r.result === "hit" ? (r.price - 1) * (1 - COMMISSION) : -1), 0);
  return {
    picks: rows.length,
    settled: settled.length,
    hitRate: settled.length ? r1((100 * settled.filter((r) => r.result === "hit").length) / settled.length) : null,
    roi: settled.length ? r1((100 * profit) / settled.length) : null,
  };
}

/** How the picks the model would bet compare with the ones it would skip, since shadow scoring began. */
export function shadowReport(db: EngineDb): ShadowReport {
  const model = getActiveModel(db);
  const rows = db.listModelScores().filter((r) => !r.excluded);
  const bet = rows.filter((r) => r.edge >= EDGE);
  const skip = rows.filter((r) => r.edge < EDGE);
  const strategies = [...new Set(rows.map((r) => r.strategy))];
  const wb = group(bet);
  const ws = group(skip);
  const reasons: string[] = [];
  const minSettled = 300;
  if (wb.settled + ws.settled < minSettled) reasons.push(`${minSettled}+ settled picks scored (has ${wb.settled + ws.settled})`);
  if (wb.roi === null || ws.roi === null || wb.roi - ws.roi < 5) reasons.push("'Would bet' beats 'would skip' by 5+ points");
  if (wb.roi === null || wb.roi <= 0) reasons.push("'Would bet' is profitable at Betfair's prices");
  // And not a fluke of one spell: the gap has to hold in the older and the newer half of the settled picks.
  const settled = rows.filter((r) => r.result === "hit" || r.result === "miss").sort((a, b) => a.scoredAt.localeCompare(b.scoredAt));
  const half = Math.floor(settled.length / 2);
  const holds = [settled.slice(0, half), settled.slice(half)].every((part) => {
    const b = group(part.filter((r) => r.edge >= EDGE));
    const s = group(part.filter((r) => r.edge < EDGE));
    return b.roi !== null && s.roi !== null && b.roi > s.roi;
  });
  if (!holds) reasons.push("The gap holds in both the older and the newer half of the shadow period");
  return {
    model: model ? { version: model.version, trainedAt: model.trainedAt, rows: model.n } : null,
    since: rows.length ? rows.reduce((m, r) => (r.scoredAt < m ? r.scoredAt : m), rows[0]!.scoredAt) : null,
    scored: rows.length,
    betfairShare: rows.length ? r1((100 * rows.filter((r) => r.priceFrom === "betfair").length) / rows.length) : null,
    wouldBet: wb,
    wouldSkip: ws,
    byStrategy: strategies
      .map((s) => ({ strategy: s, wouldBet: group(bet.filter((r) => r.strategy === s)), wouldSkip: group(skip.filter((r) => r.strategy === s)) }))
      .sort((a, b) => b.wouldBet.picks + b.wouldSkip.picks - (a.wouldBet.picks + a.wouldSkip.picks)),
    recent: rows.slice(0, 25).map((r) => ({
      pickId: r.pickId,
      strategy: r.strategy,
      match: `${r.home ?? "?"} v ${r.away ?? "?"}`,
      minute: r.minute,
      pModel: r1(r.pModel * 100),
      pNeeded: r1(r.pNeeded * 100),
      price: r.price,
      priceFrom: r.priceFrom,
      wouldBet: r.edge >= EDGE,
      result: r.status === "settled" ? r.result : null,
    })),
    ready: { met: reasons.length === 0, reasons },
  };
}

const PROVED_KEY = "goal_model_proved_notified";

/**
 * Sends ONE phone notification when the shadow results first meet the rule for turning the filter on, and remembers
 * it. If the results later stop meeting it, the note is cleared, so a later proof notifies again.
 */
export async function notifyIfProved(db: EngineDb, now = new Date()): Promise<boolean> {
  const r = shadowReport(db);
  const notified = db.getSetting(PROVED_KEY);
  if (!r.ready.met) {
    if (notified) db.setSetting(PROVED_KEY, "");
    return false;
  }
  if (notified) return false;
  db.setSetting(PROVED_KEY, now.toISOString());
  const msg = `Picks it would bet: ${r.wouldBet.roi}% per £1 (${r.wouldBet.settled}); ones it would skip: ${r.wouldSkip.roi}% (${r.wouldSkip.settled}). Turn it on for one Live strategy at £1: Strategies, open a next-goal strategy, Goal model filter: On.`;
  log.info(`Goal model proved in shadow. ${msg}`);
  await sendPush(db, { title: "Goal model proved in shadow", body: msg, url: "/more/admin/goal-model", tag: "goal-model" });
  return true;
}

let cache: { at: number; report: ModelReport } | null = null;

/** The report, worked out at most every 10 minutes (it trains two models). */
export function cachedModelReport(db: EngineDb, refresh = false): ModelReport {
  if (!refresh && cache && Date.now() - cache.at < 10 * 60_000) return cache.report;
  cache = { at: Date.now(), report: modelReport(db) };
  return cache.report;
}
