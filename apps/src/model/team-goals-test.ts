/**
 * TEST (Sim only, nothing bets differently): GoalSignal's pre-match "lively teams" filter on our next-goal picks.
 * From GoalSignal's "Overdue Goals" bots (video, 11 Oct 2026): only take a goal bet when the two teams' recent games
 *   - had a second-half goal in 75%+ of them, and
 *   - had over 1.5 goals in 74%+ of them.
 * Each next-goal pick (Next goal, Over 1.5) is checked against both teams' last 10 games BEFORE the pick's day, from the
 * football-data history (history/football-data.ts: the 38 Edge leagues, so picks from other leagues aren't covered).
 * The report compares picks that pass with picks that don't, at the prices each pick is judged at elsewhere.
 *
 * Worked out on request from what is already stored: no new API calls, no stored state. Started 11 Oct 2026; results
 * are reviewed after a week (a reminder push goes out on REVIEW_AT). Picks before the start show as "backfilled".
 */
import type { EngineDb } from "../storage/engine-db";
import { historyMatches, type HistoricMatch } from "../history/football-data";
import { searchWord } from "../betfair/exchange";
import { pricingInputs } from "../server/winloss";
import { sendPush } from "../server/push";
import { log } from "../server/log";

export const TEST_START = "2026-10-11T19:00:00.000Z";
export const REVIEW_AT = "2026-10-18T08:00:00.000Z";
const REMINDER_KEY = "team_goals_test_reminder";
const H2_MIN = 75;
const O15_MIN = 74;
const GAMES = 10;
const MIN_GAMES = 5;
const MARKETS = new Set(["NEXT_GOAL", "OVER_1_5"]);

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface Index {
  source: HistoricMatch[];
  byTeam: Map<string, HistoricMatch[]>;
  names: Array<{ name: string; plain: string }>;
}
let index: Index | null = null;

export function teamIndex(list: HistoricMatch[] = historyMatches()): Index {
  if (index && index.source === list) return index;
  const byTeam = new Map<string, HistoricMatch[]>();
  for (const m of list) {
    if (m.hthg === null || m.htag === null) continue;
    for (const t of [m.home, m.away]) (byTeam.get(t) ?? byTeam.set(t, []).get(t)!).push(m);
  }
  for (const games of byTeam.values()) games.sort((a, b) => b.date.localeCompare(a.date));
  index = { source: list, byTeam, names: [...byTeam.keys()].map((name) => ({ name, plain: plain(name) })) };
  return index;
}

/** The history's name for an alert's team, when exactly one fits. */
export function historyTeam(alertName: string, idx = teamIndex()): string | null {
  const p = plain(alertName);
  const exact = idx.names.find((n) => n.plain === p);
  if (exact) return exact.name;
  const word = plain(searchWord(alertName));
  if (word.length < 4) return null;
  const hits = idx.names.filter((n) => n.plain.split(" ").includes(word));
  return hits.length === 1 ? hits[0]!.name : null;
}

/** Both teams' last 10 games before `day`: % with a second-half goal, % over 1.5 goals. Null when not covered. */
export function teamGoalStats(home: string, away: string, day: string, idx = teamIndex()): { h2: number; o15: number; games: number } | null {
  const h = historyTeam(home, idx);
  const a = historyTeam(away, idx);
  if (!h || !a || h === a) return null;
  const last = (t: string) => (idx.byTeam.get(t) ?? []).filter((m) => m.date < day).slice(0, GAMES);
  const hg = last(h);
  const ag = last(a);
  if (hg.length < MIN_GAMES || ag.length < MIN_GAMES) return null;
  // A name match is only trusted when both teams play in the same league lately (guards "Sheffield" picking the wrong club).
  if (hg[0]!.div !== ag[0]!.div) return null;
  const games = [...hg, ...ag];
  const pct = (f: (m: HistoricMatch) => boolean) => Math.round((100 * games.filter(f).length) / games.length);
  return {
    h2: pct((m) => m.fthg + m.ftag > m.hthg! + m.htag!),
    o15: pct((m) => m.fthg + m.ftag >= 2),
    games: games.length,
  };
}

interface Group {
  picks: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  /** Return per £1 at each pick's judged price, after commission, percent. */
  roi: number | null;
}

function group(rows: Array<{ hit: boolean; odds: number | null }>, commission: number): Group {
  const priced = rows.filter((r) => r.odds !== null && r.odds > 1);
  const profit = priced.reduce((t, r) => t + (r.hit ? (r.odds! - 1) * (1 - commission) : -1), 0);
  const hits = rows.filter((r) => r.hit).length;
  return {
    picks: rows.length,
    settled: rows.length,
    hits,
    hitRate: rows.length ? Math.round((1000 * hits) / rows.length) / 10 : null,
    roi: priced.length ? Math.round((1000 * profit) / priced.length) / 10 : null,
  };
}

export interface TeamGoalsReport {
  start: string;
  reviewAt: string;
  rule: string;
  /** Settled next-goal picks checked, and how many the history covers. */
  checked: number;
  covered: number;
  sinceStart: { pass: Group; fail: Group };
  backfilled: { pass: Group; fail: Group };
  byStrategy: Array<{ strategy: string; pass: Group; fail: Group }>;
}

/** The test so far: covered settled next-goal picks, split pass / fail, since the start and before it (backfilled). */
export function teamGoalsReport(db: EngineDb, now = new Date()): TeamGoalsReport {
  const { commission, price } = pricingInputs(db);
  const from = "2026-09-25T00:00:00.000Z";
  const teams = new Map(db.listLivePicks(20_000, { from, to: now.toISOString() }).map((p) => [p.id, p]));
  const rows: Array<{ strategy: string; at: string; pass: boolean; hit: boolean; odds: number | null }> = [];
  let checked = 0;
  const idx = teamIndex();
  for (const r of db.listResultsForWinLoss(from, { ignoreFreshStart: true })) {
    if (!r.market || !MARKETS.has(r.market)) continue;
    const p = teams.get(r.id);
    if (!p?.home || !p.away) continue;
    checked++;
    const s = teamGoalStats(p.home, p.away, r.firstSeenAt.slice(0, 10), idx);
    if (!s) continue;
    rows.push({ strategy: r.strategy.replace(/\([^)]*\)/g, "").trim(), at: r.firstSeenAt, pass: s.h2 >= H2_MIN && s.o15 >= O15_MIN, hit: r.result === "hit", odds: price(r).odds });
  }
  const split = (list: typeof rows) => ({ pass: group(list.filter((x) => x.pass), commission), fail: group(list.filter((x) => !x.pass), commission) });
  const strategies = [...new Set(rows.map((r) => r.strategy))];
  return {
    start: TEST_START,
    reviewAt: REVIEW_AT,
    rule: `Both teams' last ${GAMES} games: a second-half goal in ${H2_MIN}%+ and over 1.5 goals in ${O15_MIN}%+`,
    checked,
    covered: rows.length,
    sinceStart: split(rows.filter((r) => r.at >= TEST_START)),
    backfilled: split(rows.filter((r) => r.at < TEST_START)),
    byStrategy: strategies
      .map((s) => ({ strategy: s, ...split(rows.filter((r) => r.strategy === s)) }))
      .sort((a, b) => b.pass.picks + b.fail.picks - (a.pass.picks + a.fail.picks)),
  };
}

/** Once, on or after REVIEW_AT: a push saying the week's results are ready to discuss. */
export function startTeamGoalsReminder(db: EngineDb): void {
  const check = async () => {
    if (Date.now() < Date.parse(REVIEW_AT) || db.getSetting(REMINDER_KEY)) return;
    db.setSetting(REMINDER_KEY, new Date().toISOString());
    try {
      const r = teamGoalsReport(db);
      const s = r.sinceStart;
      const body =
        s.pass.picks + s.fail.picks === 0
          ? "A week in, but no covered picks yet. Have a look and decide whether to keep it running."
          : `A week in: picks that pass ${s.pass.roi ?? "–"}% (${s.pass.picks}), picks that don't ${s.fail.roi ?? "–"}% (${s.fail.picks}). Time to review it.`;
      await sendPush(db, { title: "Team goals test: a week of results", body, url: "/more/admin/goal-model", tag: "team-goals-test" });
    } catch (err) {
      log.warn(`Team goals reminder: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  setInterval(() => void check(), 30 * 60_000).unref?.();
  setTimeout(() => void check(), 5 * 60_000).unref?.();
}
