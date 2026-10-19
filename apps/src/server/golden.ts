/**
 * The Golden page: every watched slice of a strategy (segments.ts) with its record since it started, its status, and
 * the Golden finder's suggestions for new ones.
 *
 * STATUS, from the slice's priced picks since its start (Live and Sim together):
 *   candidate        fewer than 50 so far
 *   golden           50+, making +3% or more per £1, and ahead of the rest of its strategy over the same time
 *   not holding up   50+, but not both of those
 *
 * THE FINDER looks through each strategy with 150+ priced settled picks for a slice that did clearly better than the
 * rest: one or two FEATURES (from different groups) that held 40+ picks, made +4% or more per £1, and beat the rest by
 * 5+ points in BOTH halves of the record (older and newer). With ~200 slices tried per strategy, some will look good by
 * luck, which is why a suggestion is only ever watched (from the day it's added), never bet.
 * Worked out at most every 6 hours; one notification when new suggestions appear.
 */
import type { EngineDb } from "../storage/engine-db";
import { getSendingSettings, strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { computeStrategyReturns, pricingInputs } from "./winloss";
import { FEATURES, ruleLabel, ruleTest, segmentsOf, setCustomSegments, type CustomSegment, type Feature } from "./segments";
import { sendPush } from "./push";
import { log } from "./log";

const CUSTOM_KEY = "custom_segments";
const FOUND_KEY = "golden_suggestions";
const TOLD_KEY = "golden_suggestions_told";
const SIX_HOURS = 6 * 3_600_000;

export const CONFIRM_FROM = 50;
const MIN_PICKS = 150;
const MIN_IN = 40;

export function loadCustomSegments(db: EngineDb): CustomSegment[] {
  let list: CustomSegment[] = [];
  try {
    list = JSON.parse(db.getSetting(CUSTOM_KEY) ?? "[]") as CustomSegment[];
  } catch {
    list = [];
  }
  setCustomSegments(list);
  return list;
}

function saveCustom(db: EngineDb, list: CustomSegment[]): void {
  db.setSetting(CUSTOM_KEY, JSON.stringify(list));
  setCustomSegments(list);
}

const ruleId = (rule: Feature[]) => [...rule].sort().join("+");

/** Starts watching a suggested slice from now. */
export function watchSegment(db: EngineDb, strategyKey: string, rule: Feature[], now = new Date()): CustomSegment {
  if (!Array.isArray(rule) || rule.length === 0 || rule.length > 2 || !rule.every((r) => r in FEATURES)) throw new Error("That isn't a rule the finder makes.");
  const key = strategyKey.toLowerCase();
  const id = `f-${ruleId(rule)}`;
  const list = loadCustomSegments(db);
  if (segmentsOf(key).some((s) => s.id === id || (s.rule && ruleId(s.rule) === ruleId(rule)))) throw new Error("That one is already being watched.");
  const c: CustomSegment = { strategyKey: key, id, rule, since: now.toISOString() };
  saveCustom(db, [...list, c]);
  log.info(`Golden: now watching ${ruleLabel(rule)} for ${displayName(db, key)}.`);
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
  const feats = Object.keys(FEATURES) as Feature[];
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
export function goldenSuggestions(db: EngineDb, now = new Date(), force = false): { at: string; list: GoldenSuggestion[] } {
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

/** Hourly: one notification when the finder has new suggestions. */
export async function notifyGoldenSuggestions(db: EngineDb, now = new Date()): Promise<number> {
  const { list } = goldenSuggestions(db, now);
  let told: string[] = [];
  try {
    told = JSON.parse(db.getSetting(TOLD_KEY) ?? "[]") as string[];
  } catch {
    told = [];
  }
  const id = (g: GoldenSuggestion) => `${g.strategyKey}#${ruleId(g.rule)}`;
  const fresh = list.filter((g) => !told.includes(id(g)));
  if (fresh.length === 0) return 0;
  db.setSetting(TOLD_KEY, JSON.stringify([...told, ...fresh.map(id)].slice(-200)));
  const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;
  const first = fresh[0]!;
  await sendPush(db, {
    title: fresh.length === 1 ? "Golden finder: an idea to watch" : `Golden finder: ${fresh.length} ideas to watch`,
    body: `${first.strategy}, ${first.label.replace(/^Golden: /, "")}: ${pct(first.slice.roi)} per £1 over ${first.slice.n} picks (the rest ${pct(first.rest.roi)}).${fresh.length > 1 ? ` And ${fresh.length - 1} more.` : ""} Tap to watch it.`,
    url: "/more/admin/golden",
    tag: "golden-finder",
  });
  return fresh.length;
}

export type GoldenStatus = "candidate" | "golden" | "not holding up";

/** The Golden page: each watched slice since its start (Live and Sim together), the rest of its strategy over the same time, its status and its own betting. */
export function goldenReport(db: EngineDb, now = new Date()) {
  const settings = getSendingSettings(db);
  const returns = computeStrategyReturns(db, null);
  const slices = [];
  for (const [key, r] of Object.entries(returns)) {
    for (const s of r.segments ?? []) {
      const inn = s.in.all;
      const rest = s.out.all;
      const status: GoldenStatus =
        inn.counted < CONFIRM_FROM ? "candidate" : inn.roi !== null && inn.roi >= 0.03 && (rest.roi === null || inn.roi > rest.roi) ? "golden" : "not holding up";
      const bet = settings.segmentBets[`${key}#${s.id}`] ?? null;
      slices.push({
        strategyKey: key,
        strategy: displayName(db, key),
        strategyLive: settings.enabled && settings.strategies[key] === true,
        id: s.id,
        label: s.label,
        since: s.since,
        custom: s.custom,
        status,
        slice: { live: s.in.live, sim: s.in.sim, all: inn },
        rest: { live: s.out.live, sim: s.out.sim, all: rest },
        bet,
      });
    }
  }
  return { slices, suggestions: goldenSuggestions(db, now), confirmFrom: CONFIRM_FROM };
}
