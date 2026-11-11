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

/**
 * A slice's return pulled towards its strategy's, by how few picks it has: weight n / (n + SHRINK_PICKS) on its own
 * figure. A slice is the best-looking part of a strategy out of ~200 tried, so its raw return flatters it; 40 picks at
 * +30% in a strategy at -2% is worth about +3%, and 400 picks at +30% about +19% (site review S2, 11 Nov 2026).
 */
export const SHRINK_PICKS = 200;
export function shrunkRoi(sliceRoi: number, slicePicks: number, parentRoi: number): number {
  const w = slicePicks / (slicePicks + SHRINK_PICKS);
  return Math.round((w * sliceRoi + (1 - w) * parentRoi) * 1000) / 1000;
}

export interface GoldenSuggestion {
  /** The slice's return shrunk towards its strategy's (shrunkRoi): what the finder ranks by. Missing on one saved before 11 Nov 2026. */
  shrunk?: number;
  strategyKey: string;
  strategy: string;
  rule: Feature[];
  label: string;
  /** The slice and the rest of the strategy, all time and in each half of the record. */
  slice: { n: number; hits: number; roi: number; low: number };
  rest: { n: number; roi: number };
  halves: Array<{ slice: number; rest: number }>;
}

const byShrunk = (a: GoldenSuggestion, b: GoldenSuggestion) => (b.shrunk ?? b.slice.low) - (a.shrunk ?? a.slice.low) || b.slice.low - a.slice.low;

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
    const parent = stats(all);
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
      // Ranked by this, not filtered: a slice of a losing strategy can still be the part that works (what Golden is
      // for), but it starts further back than the same figures in a strategy that is level.
      const shrunk = shrunkRoi(s.roi, s.n, parent.roi ?? 0);
      const halves = [(r: Row) => r.at < mid, (r: Row) => r.at >= mid].map((h) => ({ slice: stats(inn.filter(h)), rest: stats(rest.filter(h)) }));
      if (!halves.every((h) => h.slice.roi !== null && h.rest.roi !== null && h.slice.n >= 10 && h.slice.roi > 0 && h.slice.roi - h.rest.roi >= 0.05)) continue;
      found.push({
        shrunk,
        strategyKey: key,
        strategy: displayName(db, key),
        rule,
        label: ruleLabel(rule),
        slice: { n: s.n, hits: s.hits, roi: s.roi, low: s.low ?? s.roi },
        rest: { n: o.n, roi: o.roi },
        halves: halves.map((h) => ({ slice: h.slice.roi!, rest: h.rest.roi! })),
      });
    }
    // Best two per strategy, ranked by the return shrunk towards the strategy's (then the lower end of the likely range).
    found.sort(byShrunk);
    out.push(...found.slice(0, 2));
  }
  return out.sort(byShrunk).slice(0, 10);
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
 * Limits on what the finder watches by itself (29 Oct 2026: it had 30 quiet slices on top of 32 chosen ones, with nothing
 * ever retired). Testing that many slices makes some look good by luck alone, and they buried the page.
 */
export const QUIET_LIMITS = { perStrategy: 2, total: 12, perWeek: 3, retireAfterDays: 14, fewPicks: 10, losingFrom: 30 };

/**
 * Retires the finder's own slices (auto, never one the admin chose or bets on its own) that aren't going anywhere: after
 * QUIET_LIMITS.retireAfterDays, fewer than `fewPicks` priced picks, or `losingFrom`+ and losing. Their place in
 * `TOLD_KEY` stays, so the finder doesn't add them straight back. Returns what was retired.
 */
export function retireQuietSlices(db: EngineDb, now = new Date()): CustomSegment[] {
  const bets = getSendingSettings(db).segmentBets;
  const auto = loadCustomSegments(db).filter((c) => c.auto && !bets[`${c.strategyKey}#${c.id}`]);
  if (auto.length === 0) return [];
  const returns = computeStrategyReturns(db, null);
  const retired: CustomSegment[] = [];
  for (const c of auto) {
    if (now.getTime() - Date.parse(c.since) < QUIET_LIMITS.retireAfterDays * 86_400_000) continue;
    const inn = returns[c.strategyKey]?.segments?.find((s) => s.id === c.id)?.in.all;
    const n = inn?.counted ?? 0;
    const losing = n >= QUIET_LIMITS.losingFrom && (inn?.roi ?? 0) < 0;
    if (n >= QUIET_LIMITS.fewPicks && !losing) continue;
    retired.push(c);
  }
  if (retired.length > 0) {
    const gone = new Set(retired.map((c) => `${c.strategyKey}#${c.id}`));
    saveCustom(db, loadCustomSegments(db).filter((c) => !gone.has(`${c.strategyKey}#${c.id}`)));
    log.info(`Golden finder: retired ${retired.length} quiet slice(s) going nowhere: ${retired.map((c) => `${displayName(db, c.strategyKey)} ${ruleLabel(c.rule)}`).join("; ")}.`);
  }
  return retired;
}

/**
 * Hourly: the finder's new ideas are watched at once, quietly (no notification) and counted from today, within
 * QUIET_LIMITS (the rest stay as suggestions on the Golden page, to watch by hand). Each is kept on `TOLD_KEY` once
 * handled, so stopping one by hand (Golden page) doesn't bring it straight back next run.
 */
export function autoWatchGoldenFinds(db: EngineDb, now = new Date()): CustomSegment[] {
  retireQuietSlices(db, now);
  const { list } = goldenSuggestions(db, now);
  let told: string[] = [];
  try {
    told = JSON.parse(db.getSetting(TOLD_KEY) ?? "[]") as string[];
  } catch {
    told = [];
  }
  const id = (g: GoldenSuggestion) => `${g.strategyKey}#${ruleId(g.rule)}`;
  // Within the limits: count what the finder already watches, overall and per strategy, and take the best that fit.
  const quiet = loadCustomSegments(db).filter((c) => c.auto);
  const per = new Map<string, number>();
  for (const c of quiet) per.set(c.strategyKey, (per.get(c.strategyKey) ?? 0) + 1);
  // At most perWeek new ones in any 7 days (11 Nov 2026): every slice watched is another chance for luck to look like
  // skill, so the finder's best few are taken and the rest wait. One added this week can't have been retired yet
  // (retireAfterDays is longer), so the list itself is the count.
  const thisWeek = quiet.filter((c) => now.getTime() - Date.parse(c.since) < 7 * 86_400_000).length;
  let room = Math.min(QUIET_LIMITS.total - quiet.length, QUIET_LIMITS.perWeek - thisWeek);
  const fresh: GoldenSuggestion[] = [];
  for (const g of list) {
    if (room <= 0) break;
    if (told.includes(id(g)) || (per.get(g.strategyKey) ?? 0) >= QUIET_LIMITS.perStrategy) continue;
    fresh.push(g);
    per.set(g.strategyKey, (per.get(g.strategyKey) ?? 0) + 1);
    room--;
  }
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

/** When a slice goes to the page's "Shelved" section (3 Nov 2026: 46 slices, a third of them empty, duplicated or losing). */
export const SHELVE = { emptyAfterDays: 14, losingFrom: 30, losingRoi: -0.05, longLosingFrom: 60 };

interface TidyInput {
  strategyKey: string;
  id: string;
  label: string;
  since: string;
  status: GoldenStatus;
  why: string | null;
  notify: boolean;
  custom: boolean;
  bet: { live: boolean } | null;
  ownLive: { n: number; units: number; roi: number | null } | null;
  slice: { all: { counted: number; roi: number | null; units?: number } };
}

/**
 * Tidies the page without deleting anything: a slice with the same picks as another, none at all for two weeks, a
 * stage it lost, or a clear loss over 30+ picks is `shelved` (with the reason) and shown in its own collapsed section;
 * the record and its strategy's figures are untouched. A slice bet Live on its own, or with notifications on, is never
 * shelved for being quiet or losing (the owner is using it), and one that is losing gets `watchOut` instead, for the top of the page.
 * `signatures` is each slice's pick list as text: equal ones (same strategy) are the same slice worded twice.
 */
export function tidySlices<T extends TidyInput>(slices: T[], signatures: Map<string, string>, now = new Date()): Array<T & { shelved: string | null; watchOut: string | null }> {
  const keyOf = (s: T) => `${s.strategyKey}#${s.id}`;
  const worth = (s: T) => (s.bet?.live ? 4 : 0) + (s.notify ? 2 : 0) + (s.custom ? 0 : 1);
  const name = (s: T) => s.label.replace(/^Golden: /, "");
  // Of slices with identical picks, the one to keep: used or built-in first, then the shortest wording.
  const keep = new Map<string, T>();
  for (const s of slices) {
    const sig = signatures.get(keyOf(s));
    if (!sig) continue;
    const k = `${s.strategyKey}|${sig}`;
    const cur = keep.get(k);
    if (!cur || worth(s) > worth(cur) || (worth(s) === worth(cur) && name(s).length < name(cur).length)) keep.set(k, s);
  }
  return slices.map((s) => {
    const inn = s.slice.all;
    const used = s.bet?.live === true || s.notify;
    const days = (now.getTime() - Date.parse(s.since)) / 86_400_000;
    const sig = signatures.get(keyOf(s));
    const twin = sig ? keep.get(`${s.strategyKey}|${sig}`) : undefined;
    let shelved: string | null = null;
    if (twin && twin !== s && !used) shelved = `Same picks as “${name(twin)}”`;
    else if (!used && inn.counted === 0 && days >= SHELVE.emptyAfterDays) shelved = `No picks in ${Math.floor(days)} days`;
    else if (!used && s.status === "not holding up") shelved = `Not holding up${s.why ? `: ${s.why}` : ""}`;
    else if (!used && inn.roi !== null && ((inn.counted >= SHELVE.losingFrom && inn.roi < SHELVE.losingRoi) || (inn.counted >= SHELVE.longLosingFrom && inn.roi < 0))) shelved = `Losing over ${inn.counted} picks`;
    const live = s.bet?.live === true;
    const own = s.ownLive;
    const watchOut = !live
      ? null
      : s.status === "not holding up"
        ? `Live, and no longer holding up${s.why ? `: ${s.why}` : ""}`
        : inn.roi !== null && inn.counted >= SHELVE.losingFrom && inn.roi < 0
          ? `Live, and losing over ${inn.counted} picks`
          : own && own.n >= 15 && own.roi !== null && own.roi < 0
            ? `Live, and its own Live bets are losing over ${own.n}`
            : null;
    return { ...s, shelved, watchOut };
  });
}

/** The Golden page: each watched slice since its start (Live and Sim together), the rest of its strategy over the same time, its status and its own betting. */
export function goldenReport(db: EngineDb, now = new Date(), opts: { skipFinder?: boolean; rows?: ReturnType<EngineDb["listResultsForWinLoss"]> } = {}) {
  const settings = getSendingSettings(db);
  const notify = getGoldenNotify(db);
  // `rows` (every settled pick, read once by the caller) saves reading and pricing them all again for each report.
  const returns = computeStrategyReturns(db, null, opts.rows ? { rows: opts.rows } : undefined);
  const held = badges(db);
  // Each slice's priced picks in time order (Live and Sim, as its record), for the recent-form test.
  const { price } = pricingInputs(db);
  const segs = Object.keys(returns).flatMap((key) => segmentsOf(key).map((seg) => ({ key, seg })));
  const earliest = segs.reduce((m, x) => (x.seg.since < m ? x.seg.since : m), now.toISOString());
  const picksOf = new Map<string, Array<{ at: string; stake: number; profit: number; won: boolean }>>();
  if (segs.length > 0) {
    // The slices of each strategy together, and each pick priced once however many slices it is in (it was once per slice, over
    // every pick of every strategy: Golden took 4 s on the live data).
    const segsByKey = new Map<string, Array<(typeof segs)[number]["seg"]>>();
    for (const { key, seg } of segs) (segsByKey.get(key) ?? segsByKey.set(key, []).get(key)!).push(seg);
    for (const r of opts.rows ? opts.rows.filter((x) => x.firstSeenAt >= earliest) : db.listResultsForWinLoss(earliest)) {
      if (!r.facts) continue;
      const key = strategyLabel(r.strategy).toLowerCase();
      const mine = segsByKey.get(key);
      if (!mine) continue;
      let priced: ReturnType<typeof price>["priced"] | null = null;
      for (const seg of mine) {
        if (r.firstSeenAt < seg.since || !seg.test(r.facts)) continue;
        priced ??= price(r).priced;
        if (priced.kind !== "priced") continue;
        const k = `${key}#${seg.id}`;
        (picksOf.get(k) ?? picksOf.set(k, []).get(k)!).push({ at: r.firstSeenAt, stake: priced.stake, profit: priced.profit, won: r.result === "hit" });
      }
    }
    for (const list of picksOf.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  }
  const pctOf = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${Math.abs(Math.round(n * 1000) / 10)}%`);
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
  const signatures = new Map<string, string>();
  for (const [k, list] of picksOf) if (list.length > 0) signatures.set(k, list.map((p) => `${p.at}:${p.profit}`).join("|"));
  return {
    slices: tidySlices(slices, signatures, now),
    suggestions: opts.skipFinder ? { at: now.toISOString(), list: [] } : goldenSuggestions(db, now),
    candidateFrom: CANDIDATE_FROM,
    trialFrom: TRIAL_FROM,
    fullFrom: FULL_FROM,
    safety: SAFETY,
    // Golden alert notifications: quiet hours on or off (each slice's own switch is on the slice).
    notifyQuiet: notify.quiet,
    notifyAllSlices: notify.allSlices,
    notifyHotToday: notify.hotToday,
    notifyLeagues: notify.leagues,
    notifyHoldingOnly: notify.holdingOnly,
  };
}

/**
 * The Golden safety check: a slice bet Live on its own is switched back to Sim when its OWN Live bets since its latest
 * change (switched Live, or its stake changed) lose more than worstRoi over minBets or more. Until 8 Nov 2026 it also
 * switched a slice off the moment its whole record since it was watched (mostly Sim picks) dipped below its stage, even
 * by 0.4%: four Dominant Momentum slices switched Live by the owner at 18:00 were back in Sim at 19:11, on almost no
 * Live bets of their own.
 */
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
  const lines: string[] = [];
  for (const [k, cfg] of live) {
    const [strategyKey, id] = k.split("#") as [string, string];
    const slice = report.slices.find((s) => s.strategyKey === strategyKey && s.id === id);
    // Counted from its latest change: going Live, or its stake changing by any route.
    const from = [cfg.liveSince, settings.stakeSince[k]].filter((x): x is string => typeof x === "string").sort().at(-1);
    const rec = from ? liveSinceRecord(db, strategyKey, id, from) : null;
    const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${Math.abs(Math.round(n * 1000) / 10)}%`;
    if (!rec || rec.n < SAFETY.minBets || rec.roi === null || rec.roi >= SAFETY.worstRoi) continue;
    const why = `its own Live bets are ${pct(rec.roi)} per £1 over ${rec.n} bets`;
    saveSendingSettings(db, { segmentBets: { [k]: { live: false } } });
    const name = `${displayName(db, strategyKey)}, ${(slice?.label ?? "Golden").replace(/^Golden: /, "")}`;
    off.push(name);
    lines.push(`${name}: ${why}`);
    log.info(`Golden safety: ${name} switched to Sim because ${why}.`);
  }
  // One notification for the check, however many slices it switched (they used to arrive one each, all at once).
  if (lines.length > 0)
    await sendPush(db, {
      title: lines.length === 1 ? "Golden switched to Sim" : `${lines.length} Golden slices switched to Sim`,
      body: `${lines.join("\n")}\nTheir alerts aren't bet until you turn them back on.`,
      url: "/more/admin/golden",
      tag: "golden-off",
    });
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
  for (const t of tell) log.info(`Golden: ${t.body}`);
  // One notification per kind of news in a check (several "stage lost" at once used to arrive one each).
  const byTitle = new Map<string, typeof tell>();
  for (const t of tell) byTitle.set(t.title, [...(byTitle.get(t.title) ?? []), t]);
  for (const [title, group] of byTitle) {
    if (group.length === 1) await sendPush(db, { title, body: group[0]!.body, url: "/more/admin/golden", tag: group[0]!.tag });
    else await sendPush(db, { title: `${title} · ${group.length} slices`, body: group.map((t) => t.body).join("\n"), url: "/more/admin/golden", tag: `golden-stage-batch-${title}` });
  }
}
