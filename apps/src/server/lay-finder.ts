/**
 * LAY IDEAS (added 24 Oct 2026): the Golden finder turned round. Instead of slices that did better than the rest, it
 * looks for strategies, or slices of them, that kept LOSING when backed, and works out what laying them would have
 * made.
 *
 * Only next-goal and home-win strategies, the two GoalBrew can lay (lay-groups.ts). Each priced settled pick is laid at
 * its back price plus about two ticks (3%), risking £1 of liability: a back win loses the £1, a back loss wins
 * £1 / (lay price - 1), less 2% commission. An idea needs 40+ picks, +4% or more per £1 of liability laid, and to
 * have been profitable laid in BOTH halves of the record. As with the Golden finder, many slices are tried, so some
 * look good by luck: an idea is only ever laid in Sim (£2 liability) once the admin chooses to watch it.
 * Worked out at most every 6 hours.
 */
import type { EngineDb } from "../storage/engine-db";
import { strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { pricingInputs } from "./winloss";
import { FEATURES, ruleLabel, ruleTest, type Feature } from "./segments";
import { layGroups } from "../inplayguru/lay-groups";

const FOUND_KEY = "lay_ideas";
const SIX_HOURS = 6 * 3_600_000;
const MIN_IN = 40;
const SPREAD = 1.03;
const COMMISSION = 0.02;

export interface LayIdea {
  strategyKey: string;
  strategy: string;
  source: "NEXT_GOAL" | "HOME_TO_WIN";
  /** Empty for the whole strategy. */
  rule: Feature[];
  label: string;
  n: number;
  /** Backed: per £1 staked. Laid: per £1 of liability. */
  backedRoi: number;
  laidRoi: number;
  /** The laid return in the older and newer half of the record. */
  halves: [number, number];
}

interface Row {
  at: string;
  hit: boolean;
  backR: number;
  layR: number;
  facts: NonNullable<ReturnType<EngineDb["listResultsForWinLoss"]>[number]["facts"]>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);

export function findLayIdeas(db: EngineDb): LayIdea[] {
  const { price } = pricingInputs(db);
  const by = new Map<string, { source: LayIdea["source"]; rows: Row[] }>();
  for (const r of db.listResultsForWinLoss("1970-01-01T00:00:00.000Z")) {
    if (!r.facts || (r.market !== "NEXT_GOAL" && r.market !== "HOME_TO_WIN")) continue;
    const { priced } = price(r);
    if (priced.kind !== "priced" || priced.stake <= 0 || !(priced.odds > 1.01)) continue;
    const lay = priced.odds * SPREAD;
    const hit = r.result === "hit";
    const key = strategyLabel(r.strategy).toLowerCase();
    const entry = by.get(key) ?? by.set(key, { source: r.market, rows: [] }).get(key)!;
    entry.rows.push({ at: r.firstSeenAt, hit, backR: priced.profit / priced.stake, layR: hit ? -1 : (1 - COMMISSION) / (lay - 1), facts: r.facts });
  }
  const feats = (Object.keys(FEATURES) as Feature[]).filter((f) => !("manual" in FEATURES[f]));
  const rules: Feature[][] = [[], ...feats.map((f) => [f])];
  for (let i = 0; i < feats.length; i++)
    for (let j = i + 1; j < feats.length; j++) if (FEATURES[feats[i]!].group !== FEATURES[feats[j]!].group) rules.push([feats[i]!, feats[j]!]);

  // What's laid already: a whole strategy laid leaves nothing of it to suggest; a slice laid isn't suggested again.
  const laid = layGroups(db).filter((g) => g.lays !== null);
  const id = (rule: Feature[]) => [...rule].sort().join("+");

  const out: LayIdea[] = [];
  for (const [key, { source, rows }] of by) {
    if (rows.length < MIN_IN) continue;
    const mine = laid.filter((g) => g.lays === key);
    if (mine.some((g) => g.whole)) continue;
    rows.sort((a, b) => a.at.localeCompare(b.at));
    const mid = rows[Math.floor(rows.length / 2)]!.at;
    const found: LayIdea[] = [];
    for (const rule of rules) {
      if (mine.some((g) => g.rule && id(g.rule) === id(rule))) continue;
      const test = rule.length > 0 ? ruleTest(rule) : () => true;
      const inn = rows.filter((r) => test(r.facts));
      if (inn.length < MIN_IN) continue;
      const laidRoi = mean(inn.map((r) => r.layR));
      if (laidRoi < 0.04) continue;
      const halves = [inn.filter((r) => r.at < mid), inn.filter((r) => r.at >= mid)].map((h) => (h.length >= 10 ? mean(h.map((r) => r.layR)) : null));
      if (!halves.every((h) => h !== null && h > 0)) continue;
      found.push({
        strategyKey: key,
        strategy: displayName(db, key),
        source,
        rule,
        label: rule.length > 0 ? ruleLabel(rule).replace(/^Golden: /, "") : "every alert",
        n: inn.length,
        backedRoi: mean(inn.map((r) => r.backR)),
        laidRoi,
        halves: [halves[0]!, halves[1]!],
      });
    }
    // Best two per strategy, by the worse of its two halves (an idea has to hold up in both).
    found.sort((a, b) => Math.min(...b.halves) - Math.min(...a.halves));
    out.push(...found.slice(0, 2));
  }
  return out.sort((a, b) => Math.min(...b.halves) - Math.min(...a.halves)).slice(0, 10);
}

/** The lay ideas, worked out again when 6+ hours old (or when one is watched). */
export function layIdeas(db: EngineDb, now = new Date(), force = false): { at: string; list: LayIdea[] } {
  try {
    const saved = JSON.parse(db.getSetting(FOUND_KEY) ?? "null") as { at: string; list: LayIdea[] } | null;
    if (!force && saved && now.getTime() - Date.parse(saved.at) < SIX_HOURS) return saved;
  } catch {
    // work it out again
  }
  const fresh = { at: now.toISOString(), list: findLayIdeas(db) };
  db.setSetting(FOUND_KEY, JSON.stringify(fresh));
  return fresh;
}
