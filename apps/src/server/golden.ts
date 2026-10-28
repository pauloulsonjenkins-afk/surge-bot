/**
 * The Golden page: every watched slice of a strategy (segments.ts) with its record since it started, its stage, and
 * the Golden finder's suggestions for new ones.
 *
 * STAGE, from the slice's priced picks since its start (Live and Sim together):
 *   quiet            fewer than CANDIDATE_FROM (50) so far — a finder-found slice is watched silently, no notification
 *   candidate        CANDIDATE_FROM+, in profit (one notification)
 *   trial            TRIAL_FROM+ (150), in profit in BOTH halves of the record: a small Live trial is suggested
 *                    (1% stake, with a stop loss — never switched automatically; real money stays the admin's call)
 *   full             FULL_FROM+ (300), AND its own Live trial bets are in profit: full stake suggested
 *   not holding up   it reached candidate or further, but its last 30 priced picks lost more than 5% per £1
 * The strict loss rule applies at every stage from candidate on: lost at once on a bad last 30, and only regained
 * after 30 more picks back in profit. A notification goes out once per stage first reached, and once when it's lost.
 *
 * THE FINDER looks through each strategy with 150+ priced settled picks for a slice that did clearly better than the
 * rest: one or two FEATURES (from different groups) that held 40+ picks, made +4% or more per £1, and beat the rest by
 * 5+ points in BOTH halves of the record (older and newer). With ~200 slices tried per strategy, some will look good by
 * luck, which is why a suggestion is only ever watched (from the day it's added, quietly), never bet.
 * Worked out at most every 6 hours.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings, saveSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { computeStrategyReturns, pricingInputs } from "./winloss";
import { isLivePlacement } from "../storage/engine-db";
import { FEATURES, ruleLabel, ruleTest, SEGMENTS, segmentsOf, setCustomSegments, type CustomSegment, type Feature } from "./segments";
import type { StrategyReturn } from "./winloss";
import { sendPush } from "./push";
import { log } from "./log";
import { getGoldenNotify } from "./golden-notify";

const CUSTOM_KEY = "custom_segments";
const FOUND_KEY = "golden_suggestions";
const TOLD_KEY = "golden_suggestions_told";
const SIX_HOURS = 6 * 3_600_000;

/** Below this many priced picks a slice is watched quietly (finder-found ones only — no notification yet). */
export const CANDIDATE_FROM = 50;
/** A small Live trial (1% stake, with a stop loss) is suggested from here, if it's in profit in both halves. */
export const TRIAL_FROM = 150;
/** Full stake is suggested from here, once its own Live trial bets are in profit too. */
export const FULL_FROM = 300;
/** Keeping a stage: the last `recent` priced picks may not lose more than `worstRoi`; once lost, `regainFrom` picks
 * after the loss back above `regainRoi` win it back. */
const KEEP = { recent: 30, worstRoi: -0.05, regainFrom: 30, regainRoi: 0 };
const BADGES_KEY = "golden_badges";
const STAGE_RANK = { candidate: 1, trial: 2, full: 3 } as const;
type ToldStage = keyof typeof STAGE_RANK;

interface Badge {
  /** The highest stage ever notified for (never goes down, even while the stage is currently lost). */
  stage: ToldStage | null;
  /** When it last fell to "not holding up"; cleared once it's back to a real stage. */
  lostAt?: string;
}
function badges(db: EngineDb): Record<string, Badge> {
  try {
    return JSON.parse(db.getSetting(BADGES_KEY) ?? "{}") as Record<string, Badge>;
  } catch {
    return {};
  }
}

interface Tally {
  n: number;
  won: number;
  roi: number | null;
}
function tally(list: Array<{ stake: number; profit: number; won: boolean }>): Tally {
  const staked = list.reduce((a, p) => a + p.stake, 0);
  return { n: list.length, won: list.filter((p) => p.won).length, roi: staked > 0 ? list.reduce((a, p) => a + p.profit, 0) / staked : null };
}
const MIN_PICKS = 150;
const MIN_IN = 40;

export function loadCustomSegments(db: EngineDb): CustomSegment[] {
  let list: CustomSegment[] = [];
  try {
    list = JSON.parse(db.getSetting(CUSTOM_KEY) ?? "[]") as CustomSegment[];
  } catch {
    list = [];
  }
  // Its own betting (segmentBets) is always keyed lower-case; an id saved with mixed case (older slices) would never
  // be found there, so normalize it once here rather than leaving that mismatch to every lookup site.
  if (list.some((c) => c.id !== c.id.toLowerCase())) {
    list = list.map((c) => ({ ...c, id: c.id.toLowerCase() }));
    db.setSetting(CUSTOM_KEY, JSON.stringify(list));
  }
  setCustomSegments(list);
  return list;
}

function saveCustom(db: EngineDb, list: CustomSegment[]): void {
  db.setSetting(CUSTOM_KEY, JSON.stringify(list));
  setCustomSegments(list);
}

const ruleId = (rule: Feature[]) => [...rule].sort().join("+").toLowerCase();

/** Starts watching a suggested slice from now. `auto` marks one the finder added itself (watched quietly). */
export function watchSegment(db: EngineDb, strategyKey: string, rule: Feature[], now = new Date(), auto = false): CustomSegment {
  // The finder makes one or two parts; a slice set up by hand may add a third (e.g. leaving out some countries).
  if (!Array.isArray(rule) || rule.length === 0 || rule.length > 3 || !rule.every((r) => r in FEATURES)) throw new Error("That isn't a rule the finder makes.");
  const key = strategyKey.toLowerCase();
  const id = `f-${ruleId(rule)}`;
  const list = loadCustomSegments(db);
  if (segmentsOf(key).some((s) => s.id === id || (s.rule && ruleId(s.rule) === ruleId(rule)))) throw new Error("That one is already being watched.");
  const c: CustomSegment = { strategyKey: key, id, rule, since: now.toISOString(), ...(auto ? { auto: true } : {}) };
  saveCustom(db, [...list, c]);
  log.info(`Golden: now watching ${ruleLabel(rule)} for ${displayName(db, key)}${auto ? " (found by the finder, watched quietly)" : ""}.`);
  return c;
}

/** Stops watching a slice added from the finder (built-in ones stay). Its own betting setting is removed with it. */
export function unwatchSegment(db: EngineDb, strategyKey: string, id: string): void {
  const key = strategyKey.toLowerCase();
  const list = loadCustomSegments(db);
  const next = list.filter((c) => !(c.strategyKey === key && c.id === id));
  if (next.length === list.length) throw new Error("Only slices added from the finder can be stopped.");
  saveCustom(db, next);
}

interface Row {
  at: string;
  hit: boolean;
  stake: number;
  profit: number;
  facts: NonNullable<ReturnType<EngineDb["listResultsForWinLoss"]>[number]["facts"]>;
}

function stats(rows: Row[]): { n: number; hits: number; roi: number | null; low: number | null } {
  const n = rows.length;
  if (n === 0) return { n: 0, hits: 0, roi: null, low: null };
  const staked = rows.reduce((t, r) => t + r.stake, 0);
  const profit = rows.reduce((t, r) => t + r.profit, 0);
  const rs = rows.map((r) => r.profit / r.stake);
  const mean = rs.reduce((t, x) => t + x, 0) / n;
  const sd = Math.sqrt(rs.reduce((t, x) => t + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const roi = staked > 0 ? profit / staked : null;
  return { n, hits: rows.filter((r) => r.hit).length, roi, low: roi === null ? null : roi - (1.96 * sd) / Math.sqrt(n) };
}

export interface GoldenSuggestion {
  strategyKey: string;
  strategy: string;
  rule: Feature[];
  label: string;
  /** The slice and the rest of the strategy, all time and in each half of the record. */
  slice: { n: number; hits: number; roi: number; low: number };
  rest: { n: number; roi: number };
  halves: Array<{ slice: number; rest: number }>;
}

/** The finder: new slices worth watching, best first. */
export function findGolden(db: EngineDb): GoldenSuggestion[] {
  const { price } = pricingInputs(db);
  const by = new Map<string, Row[]>();
  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")) {
    if (!r.facts) continue;
    const { priced } = price(r);
    if (priced.kind !== "priced" || priced.stake <= 0) continue;
    const key = strategyLabel(r.strategy).toLowerCase();
    (by.get(key) ?? by.set(key, []).get(key)!).push({ at: r.firstSeenAt, hit: r.result === "hit", stake: priced.stake, profit: priced.profit, facts: r.facts });
  }
  const feats = (Object.keys(FEATURES) as Feature[]).filter((f) => !("manual" in FEATURES[f]));
  const rules: Feature[][] = feats.map((f) => [f]);
  for (let i = 0; i < feats.length; i++)
    for (let j = i + 1; j < feats.length; j++) if (FEATURES[feats[i]!].group !== FEATURES[feats[j]!].group) rules.push([feats[i]!, feats[j]!]);

  const out: GoldenSuggestion[] = [];
  for (const [key, all] of by) {
    if (all.length < MIN_PICKS) continue;
    all.sort((a, b) => a.at.localeCompare(b.at));
    const mid = all[Math.floor(all.length / 2)]!.at;
    const watched = new Set(segmentsOf(key).filter((s) => s.rule).map((s) => ruleId(s.rule!)));
    const found: GoldenSuggestion[] = [];
    for (const rule of rules) {
      if (watched.has(ruleId(rule))) continue;
      const test = ruleTest(rule);
      const inn = all.filter((r) => test(r.facts));
      if (inn.length < MIN_IN || all.length - inn.length < MIN_IN) continue;
      const rest = all.filter((r) => !test(r.facts));
      const s = stats(inn);
      const o = stats(rest);
      if (s.roi === null || o.roi === null || s.roi < 0.04) continue;
      const halves = [(r: Row) => r.at < mid, (r: Row) => r.at >= mid].map((h) => ({ slice: stats(inn.filter(h)), rest: stats(rest.filter(h)) }));
      if (!halves.every((h) => h.slice.roi !== null && h.rest.roi !== null && h.slice.n >= 10 && h.slice.roi > 0 && h.slice.roi - h.rest.roi >= 0.05)) continue;
      found.push({
        strategyKey: key,
        strategy: displayName(db, key),
        rule,
        label: ruleLabel(rule),
        slice: { n: s.n, hits: s.hits, roi: s.roi, low: s.low ?? s.roi },
        rest: { n: o.n, roi: o.roi },
        halves: halves.map((h) => ({ slice: h.slice.roi!, rest: h.rest.roi! })),
      });
    }
    // Best two per strategy, ranked by the lower end of the likely range; a pair must beat its single parts.
    found.sort((a, b) => b.slice.low - a.slice.low);
    out.push(...found.slice(0, 2));
  }
  return out.sort((a, b) => b.slice.low - a.slice.low).slice(0, 10);
}

/** The finder's suggestions, worked out again when 6+ hours old. */
function goldenSuggestions(db: EngineDb, now = new Date(), force = false): { at: string; list: GoldenSuggestion[] } {
  try {
    const saved = JSON.parse(db.getSetting(FOUND_KEY) ?? "null") as { at: string; list: GoldenSuggestion[] } | null;
    if (!force && saved && now.getTime() - Date.parse(saved.at) < SIX_HOURS) {
      // Drop any now being watched.
      return { at: saved.at, list: saved.list.filter((g) => !segmentsOf(g.strategyKey).some((s) => s.rule && ruleId(s.rule) === ruleId(g.rule))) };
    }
  } catch {
    // work it out again
  }
  const fresh = { at: now.toISOString(), list: findGolden(db) };
  db.setSetting(FOUND_KEY, JSON.stringify(fresh));
  return fresh;
}

/**
 * Hourly: the finder's new ideas are watched at once, quietly (no notification) and counted from today. Each is kept
 * on `TOLD_KEY` once handled, so stopping one by hand (Golden page) doesn't bring it straight back next run.
 */
export function autoWatchGoldenFinds(db: EngineDb, now = new Date()): CustomSegment[] {
  const { list } = goldenSuggestions(db, now);
  let told: string[] = [];
  try {
    told = JSON.parse(db.getSetting(TOLD_KEY) ?? "[]") as string[];
  } catch {
    told = [];
  }
  const id = (g: GoldenSuggestion) => `${g.strategyKey}#${ruleId(g.rule)}`;
  const fresh = list.filter((g) => !told.includes(id(g)));
  if (fresh.length === 0) return [];
  db.setSetting(TOLD_KEY, JSON.stringify([...told, ...fresh.map(id)].slice(-200)));
  const added: CustomSegment[] = [];
  for (const g of fresh) {
    try {
      added.push(watchSegment(db, g.strategyKey, g.rule, now, true));
    } catch (err) {
      log.warn(`Golden finder: couldn't watch ${g.label} for ${g.strategy}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return added;
}

export type GoldenStatus = "quiet" | "candidate" | "trial" | "full" | "not holding up";

/** How close a slice is to its next stage, from its current status and priced picks since it started. Null once it
 * has no next stage to reach ("full"), or while it's "not holding up" (it has to re-prove the stage it already lost
 * before a next one means anything). Shared by the Golden page (a number on the card) and the daily review's
 * "worth watching" line, so the two always agree. */
export function nextStageOf(status: GoldenStatus, counted: number): { name: string; threshold: number; picksAway: number } | null {
  const next = status === "quiet" ? { threshold: CANDIDATE_FROM, name: "a candidate" } : status === "candidate" ? { threshold: TRIAL_FROM, name: "a Live trial" } : status === "trial" ? { threshold: FULL_FROM, name: "full stake" } : null;
  if (!next) return null;
  const picksAway = next.threshold - counted;
  return picksAway > 0 ? { ...next, picksAway } : null;
}

/** The Golden page: each watched slice since its start (Live and Sim together), the rest of its strategy over the same time, its status and its own betting. */
export function goldenReport(db: EngineDb, now = new Date(), opts: { skipFinder?: boolean } = {}) {
  const settings = getSendingSettings(db);
  const notify = getGoldenNotify(db);
  const returns = computeStrategyReturns(db, null);
  const held = badges(db);
  // Each slice's priced picks in time order (Live and Sim, as its record), for the recent-form test.
  const { price } = pricingInputs(db);
  const segs = Object.keys(returns).flatMap((key) => segmentsOf(key).map((seg) => ({ key, seg })));
  const earliest = segs.reduce((m, x) => (x.seg.since < m ? x.seg.since : m), now.toISOString());
  const picksOf = new Map<string, Array<{ at: string; stake: number; profit: number; won: boolean }>>();
  if (segs.length > 0) {
    for (const r of db.listResultsForWinLoss(earliest)) {
      if (!r.facts) continue;
      const key = strategyLabel(r.strategy).toLowerCase();
      for (const { seg } of segs.filter((x) => x.key === key)) {
        if (r.firstSeenAt < seg.since || !seg.test(r.facts)) continue;
        const { priced } = price(r);
        if (priced.kind !== "priced") continue;
        const k = `${key}#${seg.id}`;
        (picksOf.get(k) ?? picksOf.set(k, []).get(k)!).push({ at: r.firstSeenAt, stake: priced.stake, profit: priced.profit, won: r.result === "hit" });
      }
    }
    for (const list of picksOf.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  }
  const pctOf = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`);
  /** The stage its picks alone would earn, ignoring the last-30 and re-proving rules (stage(), below, applies those). */
  function rawStage(inn: StrategyReturn, picks: Array<{ at: string; stake: number; profit: number; won: boolean }>, ownLive: ReturnType<typeof liveSinceRecord> | null): GoldenStatus {
    if (inn.counted < CANDIDATE_FROM) return "quiet";
    if (!(inn.roi !== null && inn.roi > 0)) return "not holding up";
    if (inn.counted >= TRIAL_FROM) {
      const mid = picks[Math.floor(picks.length / 2)]!.at;
      const older = tally(picks.filter((p) => p.at < mid));
      const newer = tally(picks.filter((p) => p.at >= mid));
      const bothHalves = older.roi !== null && older.roi > 0 && newer.roi !== null && newer.roi > 0;
      if (bothHalves && inn.counted >= FULL_FROM && ownLive !== null && ownLive.n > 0 && ownLive.roi !== null && ownLive.roi > 0) return "full";
      if (bothHalves) return "trial";
    }
    return "candidate";
  }
  const slices = [];
  for (const [key, r] of Object.entries(returns)) {
    for (const s of r.segments ?? []) {
      const inn = s.in.all;
      const rest = s.out.all;
      const picks = picksOf.get(`${key}#${s.id}`) ?? [];
      const recent = tally(picks.slice(-KEEP.recent));
      const lostAt = held[`${key}#${s.id}`]?.lostAt ?? null;
      const regain = lostAt ? tally(picks.filter((p) => p.at >= lostAt)) : null;
      const auto = s.auto === true;
      const bet = settings.segmentBets[`${key}#${s.id}`] ?? null;
      const ownLive = bet?.live && bet.liveSince ? liveSinceRecord(db, key, s.id, bet.liveSince) : null;
      const raw = rawStage(inn, picks, ownLive);
      let status: GoldenStatus = raw;
      let why: string | null = null;
      // The strict loss rule, from candidate on: a bad last 30 loses the current stage at once; only 30 good picks
      // (back in profit) after that win it back.
      if (raw !== "quiet") {
        if (raw === "not holding up") {
          why = `${pctOf(inn.roi)} per £1 since it started`;
        } else if (recent.n >= KEEP.recent && recent.roi !== null && recent.roi < KEEP.worstRoi) {
          status = "not holding up";
          why = `its last ${recent.n} picks are ${pctOf(recent.roi)} per £1`;
        } else if (regain && !(regain.n >= KEEP.regainFrom && regain.roi !== null && regain.roi > KEEP.regainRoi)) {
          status = "not holding up";
          why = `re-proving after losing its stage: ${regain.n} of ${KEEP.regainFrom} picks, ${pctOf(regain.roi)} per £1 (needs to be in profit)`;
        }
      }
      slices.push({
        strategyKey: key,
        strategy: displayName(db, key),
        strategyLive: settings.enabled && settings.strategies[key] === true,
        id: s.id,
        label: s.label,
        since: s.since,
        custom: s.custom,
        auto,
        // Found by the finder and not yet at CANDIDATE_FROM picks: watched quietly, in its own collapsed section.
        quiet: auto && status === "quiet",
        status,
        why,
        recent,
        lostAt,
        slice: { live: s.in.live, sim: s.in.sim, all: inn },
        rest: { live: s.out.live, sim: s.out.sim, all: rest },
        bet,
        ownLive,
        notify: notify.slices[`${key}#${s.id}`] === true,
        nextStage: nextStageOf(status, inn.counted),
      });
    }
  }
  // Watched slices with nothing settled since they started (just added, or started today) still show, empty.
  const empty = (): StrategyReturn => ({ settled: 0, hits: 0, counted: 0, staked: 0, profit: 0, units: 0, roi: null } as StrategyReturn);
  const keys = new Set([...Object.keys(SEGMENTS), ...loadCustomSegments(db).map((c) => c.strategyKey)]);
  for (const key of keys) {
    for (const s of segmentsOf(key)) {
      if (slices.some((x) => x.strategyKey === key && x.id === s.id)) continue;
      const bet = settings.segmentBets[`${key}#${s.id}`] ?? null;
      const auto = s.auto === true;
      slices.push({
        strategyKey: key,
        strategy: displayName(db, key),
        strategyLive: settings.enabled && settings.strategies[key] === true,
        id: s.id,
        label: s.label,
        since: s.since,
        custom: s.custom === true,
        auto,
        quiet: auto,
        status: "quiet" as GoldenStatus,
        why: null,
        recent: { n: 0, won: 0, roi: null } as Tally,
        lostAt: null,
        slice: { live: empty(), sim: empty(), all: empty() },
        rest: { live: empty(), sim: empty(), all: empty() },
        bet,
        ownLive: bet?.live && bet.liveSince ? liveSinceRecord(db, key, s.id, bet.liveSince) : null,
        notify: notify.slices[`${key}#${s.id}`] === true,
        nextStage: nextStageOf("quiet", 0),
      });
    }
  }
  return {
    slices,
    suggestions: opts.skipFinder ? { at: now.toISOString(), list: [] } : goldenSuggestions(db, now),
    candidateFrom: CANDIDATE_FROM,
    trialFrom: TRIAL_FROM,
    fullFrom: FULL_FROM,
    safety: SAFETY,
    // Golden alert notifications: quiet hours on or off (each slice's own switch is on the slice).
    notifyQuiet: notify.quiet,
  };
}

/** The Golden safety check: a slice bet Live on its own is switched back to Sim when it stops earning its place. */
const SAFETY = { minBets: 30, worstRoi: -0.05 };

/** A slice's own Live bets since it was switched Live (its strategy's Live bets in that slice). */
export function liveSinceRecord(db: EngineDb, strategyKey: string, segmentId: string, since: string): { n: number; won: number; staked: number; profit: number; units: number; roi: number | null } {
  const seg = segmentsOf(strategyKey).find((s) => s.id === segmentId);
  const out = { n: 0, won: 0, staked: 0, profit: 0, units: 0, roi: null as number | null };
  if (!seg) return out;
  const { price } = pricingInputs(db);
  for (const r of db.listResultsForWinLoss(since)) {
    if (strategyLabel(r.strategy).toLowerCase() !== strategyKey || !r.facts || !seg.test(r.facts) || !isLivePlacement(r.placement) || r.byHand) continue;
    const { priced } = price(r);
    if (priced.kind !== "priced") continue;
    out.n++;
    if (r.result === "hit") out.won++;
    out.staked += priced.stake;
    out.profit += priced.profit;
    if (priced.stake > 0) out.units += priced.profit / priced.stake;
  }
  out.units = Math.round(out.units * 100) / 100;
  out.roi = out.staked > 0 ? out.profit / out.staked : null;
  return out;
}

/**
 * Hourly: every slice bet Live on its own is checked. Switched back to Sim (with a notification) when its status turns
 * "not holding up", or its own Live bets have lost more than 5% per £1 over 30+ bets. Turning it back on is the admin's.
 */
export async function monitorGoldenBets(db: EngineDb, now = new Date()): Promise<string[]> {
  const settings = getSendingSettings(db);
  const live = Object.entries(settings.segmentBets).filter(([, c]) => c.live);
  const report = goldenReport(db, now, { skipFinder: true });
  await updateBadges(db, report.slices, now);
  if (live.length === 0) return [];
  const off: string[] = [];
  for (const [k, cfg] of live) {
    const [strategyKey, id] = k.split("#") as [string, string];
    const slice = report.slices.find((s) => s.strategyKey === strategyKey && s.id === id);
    const rec = cfg.liveSince ? liveSinceRecord(db, strategyKey, id, cfg.liveSince) : null;
    const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;
    let why: string | null = null;
    if (slice?.status === "not holding up") why = `it's no longer holding up: ${slice.why ?? `${pct(slice.slice.all.roi ?? 0)} per £1 over ${slice.slice.all.counted} picks`}`;
    else if (rec && rec.n >= SAFETY.minBets && rec.roi !== null && rec.roi < SAFETY.worstRoi) why = `its own Live bets are ${pct(rec.roi)} per £1 over ${rec.n} bets`;
    if (!why) continue;
    saveSendingSettings(db, { segmentBets: { [k]: { live: false } } });
    const name = `${displayName(db, strategyKey)}, ${(slice?.label ?? "Golden").replace(/^Golden: /, "")}`;
    off.push(name);
    log.info(`Golden safety: ${name} switched to Sim because ${why}.`);
    await sendPush(db, { title: "Golden switched to Sim", body: `${name}: switched to Sim because ${why}. Its alerts aren't bet until you turn it back on.`, url: "/more/admin/golden", tag: `golden-off-${k}` });
  }
  return off;
}

const STAGE_MESSAGE: Record<ToldStage, (name: string) => { title: string; body: string }> = {
  candidate: (name) => ({ title: "Golden candidate", body: `${name} has made ${CANDIDATE_FROM}+ priced picks in profit — worth a look.` }),
  trial: (name) => ({
    title: "Golden: small Live trial suggested",
    body: `${name} has made ${TRIAL_FROM}+ priced picks, in profit in both halves of its record. Worth a small Live trial — 1% stake, with a stop loss — the choice is yours.`,
  }),
  full: (name) => ({
    title: "Golden: full stake suggested",
    body: `${name} has made ${FULL_FROM}+ priced picks and its own Live trial is in profit. Worth its full stake now — the choice is yours.`,
  }),
};

/**
 * Hourly, before the Live check: notes each slice's stage. Reaching a new stage (candidate, trial, full) is told once,
 * ever; losing the current stage on a bad last 30 is told once too, until it's won back. The first run only records
 * where things stand, so nothing is announced for slices already past a stage.
 */
async function updateBadges(db: EngineDb, slices: Array<{ strategyKey: string; id: string; label: string; status: GoldenStatus; why: string | null }>, now = new Date()): Promise<void> {
  const first = db.getSetting(BADGES_KEY) === null;
  const held = badges(db);
  const tell: Array<{ title: string; body: string; tag: string }> = [];
  for (const s of slices) {
    const k = `${s.strategyKey}#${s.id}`;
    const was = held[k] ?? { stage: null };
    const name = `${displayName(db, s.strategyKey)}, ${s.label.replace(/^Golden: /, "")}`;
    const wasRank = was.stage ? STAGE_RANK[was.stage] : 0;
    if (s.status === "not holding up") {
      if (was.stage !== null) {
        if (!first && !was.lostAt) tell.push({ title: "Golden stage lost", body: `${name} has slipped: ${s.why ?? "it stopped being profitable"}. It needs ${KEEP.regainFrom} new picks back in profit to be considered again.`, tag: `golden-stage-${k}` });
        held[k] = { stage: was.stage, lostAt: now.toISOString() };
      } else held[k] = { stage: null };
    } else if (s.status !== "quiet") {
      const rank = STAGE_RANK[s.status];
      if (rank > wasRank) {
        for (let lvl = wasRank + 1; lvl <= rank; lvl++) {
          const stageName = (Object.keys(STAGE_RANK) as ToldStage[]).find((n) => STAGE_RANK[n] === lvl)!;
          if (!first) tell.push({ ...STAGE_MESSAGE[stageName](name), tag: `golden-stage-${stageName}-${k}` });
        }
      }
      held[k] = { stage: rank > wasRank ? s.status : was.stage };
    }
  }
  db.setSetting(BADGES_KEY, JSON.stringify(held));
  for (const t of tell) {
    log.info(`Golden: ${t.body}`);
    await sendPush(db, { title: t.title, body: t.body, url: "/more/admin/golden", tag: t.tag });
  }
}
