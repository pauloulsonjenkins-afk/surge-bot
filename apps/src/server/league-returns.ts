/**
 * Money by league, and by league and strategy, for the Leagues page's Profit tab, milestone notifications and the
 * "stop this strategy in this league" suggestion.
 *
 * Every settled pick is priced exactly as Profit / Strategies price it (pricingInputs), so the figures agree. Each
 * group keeps the sum and sum of squares of each priced pick's return per £1, so a likely range can be given: with
 * a few hundred leagues, a dozen will look awful by luck alone, so nothing is called "losing" until the whole range
 * is below zero.
 *
 * MILESTONES: a league, a country, or a strategy within a league reaching 50, 100, 250 or 500 priced picks (Live and
 * Sim together) gets one notification with its return and verdict. The first run only records where everything
 * stands, so turning this on never sends a flood.
 *
 * BLOCKS: a strategy stopped in a league (from the Leagues page, or Apply on the suggestion) isn't bet there; its
 * picks there are recorded in Sim instead, so the block can be judged and undone.
 */
import { isLivePlacement, leagueIdentity, type EngineDb } from "../storage/engine-db";
import { pricingInputs, settledSince, type ResultRow } from "./winloss";
import { strategyLabel } from "../inplayguru/bet-feed";
import { displayName } from "../inplayguru/strategy-names";
import { sendPush } from "./push";
import { log } from "./log";
import { saveLeagueBlock } from "../inplayguru/league-blocks";
export { getLeagueBlocks, isLeagueBlocked,  } from "../inplayguru/league-blocks";

export const MILESTONES = [50, 100, 250, 500];
/** Priced picks before a strategy-in-a-league can be suggested for stopping. */
export const BLOCK_FROM = 100;
const MILESTONE_KEY = "league_milestones";

export interface Tally {
  /** Settled picks, and how many won and lost. */
  picks: number;
  won: number;
  lost: number;
  /** Priced picks (a known stake and price), and their £ figures. */
  counted: number;
  staked: number;
  profit: number;
  /** Sum and sum of squares of each priced pick's return per £1, for the likely range. */
  sumR: number;
  sumR2: number;
}
type Modes = { live: Tally; sim: Tally; all: Tally };

export interface LeagueReturn {
  key: string;
  league: string;
  country: string | null;
  modes: Modes;
  /** Lower-case strategy name -> its figures in this league. */
  byStrategy: Record<string, Modes>;
}

const empty = (): Tally => ({ picks: 0, won: 0, lost: 0, counted: 0, staked: 0, profit: 0, sumR: 0, sumR2: 0 });
const modes = (): Modes => ({ live: empty(), sim: empty(), all: empty() });

function add(t: Tally, hit: boolean, priced: { stake: number; profit: number } | null): void {
  t.picks++;
  if (hit) t.won++;
  else t.lost++;
  if (priced && priced.stake > 0) {
    t.counted++;
    t.staked += priced.stake;
    t.profit += priced.profit;
    const r = priced.profit / priced.stake;
    t.sumR += r;
    t.sumR2 += r * r;
  }
}

/** Every league's figures since `sinceIso` (null = all time), busiest first. `rows`: every settled pick, already read (see settledSince). */
export function computeLeagueReturns(db: EngineDb, sinceIso: string | null = null, rows?: ResultRow[]): LeagueReturn[] {
  const { price } = pricingInputs(db);
  const out = new Map<string, LeagueReturn>();
  for (const r of settledSince(db, sinceIso, rows)) {
    const id = leagueIdentity(r.competition, r.country);
    let l = out.get(id.key);
    if (!l) out.set(id.key, (l = { key: id.key, league: id.league, country: id.country, modes: modes(), byStrategy: {} }));
    const { priced } = price(r);
    const p = priced.kind === "priced" ? { stake: priced.stake, profit: priced.profit } : null;
    const hit = r.result === "hit";
    const s = strategyLabel(r.strategy).toLowerCase();
    const sm = (l.byStrategy[s] ??= modes());
    const mode = isLivePlacement(r.placement) ? "live" : r.placement === "sim" ? "sim" : null;
    for (const m of [l.modes, sm]) {
      add(m.all, hit, p);
      if (mode) add(m[mode], hit, p);
    }
  }
  return [...out.values()].sort((a, b) => b.modes.all.picks - a.modes.all.picks);
}

export type Verdict = "early" | "losing" | "winning" | "unclear";

/** Return per £1, its likely range (about 95%), and the verdict: "losing" only when the whole range is below zero. */
export function judge(t: Tally): { roi: number | null; low: number | null; high: number | null; verdict: Verdict } {
  if (t.counted === 0 || t.staked <= 0) return { roi: null, low: null, high: null, verdict: "early" };
  const roi = t.profit / t.staked;
  if (t.counted < 2) return { roi, low: null, high: null, verdict: "early" };
  const mean = t.sumR / t.counted;
  const variance = Math.max(0, (t.sumR2 - t.counted * mean * mean) / (t.counted - 1));
  const half = 1.96 * Math.sqrt(variance / t.counted);
  const low = roi - half;
  const high = roi + half;
  const verdict: Verdict = t.counted < MILESTONES[0]! ? "early" : high < 0 ? "losing" : low > 0 ? "winning" : "unclear";
  return { roi, low, high, verdict };
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 1000) / 10}%`;

function verdictWords(v: Verdict): string {
  return v === "losing" ? "clearly losing" : v === "winning" ? "clearly making money" : "too early to call";
}

/** One line for a group reaching a milestone: its return, range and verdict. */
function milestoneLine(name: string, n: number, t: Tally): string {
  const j = judge(t);
  const range = j.low !== null && j.high !== null ? ` (likely ${pct(j.low)} to ${pct(j.high)})` : "";
  return `${name} reached ${n} picks: ${j.roi === null ? "no price yet" : `${pct(j.roi)} per £1`}${range}, ${verdictWords(j.verdict)}.`;
}

/** The milestones reached that haven't been told yet; with `seed`, records them without telling (the first run). */
export function newMilestones(db: EngineDb, leagues: LeagueReturn[], opts: { seed?: boolean } = {}): string[] {
  let state: Record<string, number> = {};
  const stored = db.getSetting(MILESTONE_KEY);
  try {
    state = JSON.parse(stored ?? "{}") as Record<string, number>;
  } catch {
    state = {};
  }
  const seed = opts.seed ?? stored === null;
  const lines: string[] = [];
  const reached = (n: number) => [...MILESTONES].reverse().find((m) => n >= m) ?? 0;
  const check = (id: string, name: string, t: Tally) => {
    const m = reached(t.counted);
    if (m === 0 || (state[id] ?? 0) >= m) return;
    state[id] = m;
    if (!seed) lines.push(milestoneLine(name, m, t));
  };
  const countries = new Map<string, Tally>();
  for (const l of leagues) {
    const where = l.country ? `${l.league} (${l.country})` : l.league;
    check(`L:${l.key}`, where, l.modes.all);
    for (const [s, m] of Object.entries(l.byStrategy)) check(`S:${s}@${l.key}`, `${displayName(db, s)} in ${where}`, m.all);
    if (l.country) {
      const c = countries.get(l.country) ?? empty();
      const a = l.modes.all;
      c.picks += a.picks; c.won += a.won; c.lost += a.lost; c.counted += a.counted; c.staked += a.staked; c.profit += a.profit; c.sumR += a.sumR; c.sumR2 += a.sumR2;
      countries.set(l.country, c);
    }
  }
  for (const [c, t] of countries) check(`C:${c}`, `${c} (all leagues)`, t);
  db.setSetting(MILESTONE_KEY, JSON.stringify(state));
  return lines;
}

/** Hourly: one notification for any new milestones. Returns how many. */
export async function notifyLeagueMilestones(db: EngineDb): Promise<number> {
  const lines = newMilestones(db, computeLeagueReturns(db));
  if (lines.length === 0) return 0;
  log.info(`League milestones: ${lines.join(" ")}`);
  await sendPush(db, {
    title: lines.length === 1 ? "League check" : `League check: ${lines.length} milestones`,
    body: lines.length <= 3 ? lines.join(" ") : `${lines.slice(0, 3).join(" ")} And ${lines.length - 3} more on the Leagues page.`,
    url: "/more/admin/leagues?tab=profit",
    tag: "league-milestones",
  });
  return lines.length;
}

// ---- Blocks: a strategy stopped in a league (stored in inplayguru/league-blocks.ts) ---------------------

/** Stops (or with `blocked` false, restarts) a strategy in a league, with a log line. */
export function setLeagueBlock(db: EngineDb, strategy: string, leagueKey: string, league: string, blocked: boolean, now = new Date()): void {
  const s = strategyLabel(strategy).toLowerCase();
  saveLeagueBlock(db, s, leagueKey, league, blocked, now);
  log.info(`${displayName(db, s)} ${blocked ? "stopped" : "restarted"} in ${league}.`);
}
