/**
 * EDGE: a read-only pre-match insight card for upcoming fixtures, shown to members (Members > Fixtures).
 *
 * It never touches betting: it only reads past results and writes its own table. Phase 1 (counting from past
 * results): a headline signal and ranked trends, each with its sample ("8 of last 10"):
 *   - goals over/under 1.5, 2.5 and 3.5, both teams to score and a goal before half-time, in the two teams' recent games;
 *   - home form (the home side at home) and away form (the away side away), and current unbeaten / winless / scoring runs;
 *   - head-to-head over up to six seasons;
 *   - bookings (over 3.5 cards), where the league's files record them.
 *
 * Data: football-data.co.uk (free; the League history downloader in history/football-data.ts keeps the results), and
 * its weekly upcoming-fixtures files, which use the same team names, so nothing has to be matched by name. No API calls.
 * A job works the cards out a few times a day for fixtures in the next 48 hours and stores them; a page view only reads.
 */
import type { EngineDb } from "../storage/engine-db";
import { DIVISIONS, download, historyMatches, historyStatus, splitCsvLine, type HistoricMatch } from "../history/football-data";
import { log } from "../server/log";

const BASE = "https://football-data.co.uk";
/** Fixtures this far ahead get a card. */
const AHEAD_MS = 48 * 3_600_000;
/** Kept a little after kick-off, so a card doesn't vanish the moment a match starts. */
const AFTER_KICKOFF_MS = 2 * 3_600_000;
const RUN_EVERY_MS = 6 * 3_600_000;
/** Fewer games than this and a trend is too thin to show. */
const MIN_SAMPLE = 5;
const TOP = 8;

export interface UpcomingFixture {
  div: string;
  league: string;
  country: string;
  /** Kick-off, ISO (UTC). */
  kickoff: string;
  home: string;
  away: string;
}

export interface EdgeTrend {
  /** What the line counts, e.g. "goals", "btts", "form", "run", "h2h", "cards", "half". */
  kind: string;
  text: string;
  hits: number;
  sample: number;
  /** hits / sample, 0-1. */
  rate: number;
  /** How strong the trend is once its sample size is allowed for (the lower end of its likely range). Ranks the list. */
  strength: number;
}

export interface EdgeCard {
  fixture: UpcomingFixture;
  headline: EdgeTrend | null;
  trends: EdgeTrend[];
  /** How many past games each side's figures come from. */
  homeGames: number;
  awayGames: number;
  computedAt: string;
}

// --------------------------------------------------------------------------- the upcoming fixtures

/** "09/10/2026", "19:45" in UK time -> ISO (UTC). */
export function ukKickoff(date: string, time: string): string | null {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec((time || "15:00").trim());
  if (!d || !t) return null;
  const y = d[3]!.length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  const asUtc = Date.UTC(y, Number(d[2]) - 1, Number(d[1]), Number(t[1]), Number(t[2]));
  // The UK is an hour ahead of UTC in summer: find which by reading that moment back in London time.
  const londonHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(asUtc));
  const offset = (londonHour - Number(t[1]) + 24) % 24;
  return new Date(asUtc - offset * 3_600_000).toISOString();
}

/** Reads football-data's two fixtures files (main leagues by division code; extra leagues by country). */
export function parseFixtures(mainCsv: string, extraCsv: string): UpcomingFixture[] {
  const out: UpcomingFixture[] = [];
  const rows = (csv: string) => {
    const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) return [] as Array<(c: string) => string>;
    const head = splitCsvLine(lines[0]!).map((h) => h.trim());
    const idx = new Map(head.map((h, i) => [h, i]));
    return lines.slice(1).map((l) => {
      const cells = splitCsvLine(l);
      return (c: string) => (cells[idx.get(c) ?? -1] ?? "").trim();
    });
  };
  for (const get of rows(mainCsv)) {
    const div = DIVISIONS.find((d) => d.code === get("Div"));
    const kickoff = ukKickoff(get("Date"), get("Time"));
    if (!div || !kickoff || !get("HomeTeam") || !get("AwayTeam")) continue;
    out.push({ div: div.code, league: div.name, country: div.country, kickoff, home: get("HomeTeam"), away: get("AwayTeam") });
  }
  for (const get of rows(extraCsv)) {
    const div = DIVISIONS.find((d) => d.kind === "extra" && d.country.toLowerCase() === get("Country").toLowerCase());
    const kickoff = ukKickoff(get("Date"), get("Time"));
    if (!div || !kickoff || !get("Home") || !get("Away")) continue;
    out.push({ div: div.code, league: div.name, country: div.country, kickoff, home: get("Home"), away: get("Away") });
  }
  return out;
}

// --------------------------------------------------------------------------- the trends

/** The lower end of the likely range of a rate (Wilson, about 90%): "9 of 10" ranks below "45 of 50". */
export function strengthOf(hits: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.645;
  const p = hits / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return (centre - spread) / (1 + (z * z) / n);
}

function trend(kind: string, text: string, hits: number, sample: number): EdgeTrend {
  return { kind, text, hits, sample, rate: sample ? hits / sample : 0, strength: strengthOf(hits, sample) };
}

/** A yes/no count read whichever way is stronger: "Over 2.5 in 8 of 10", or "Under 2.5 in 8 of 10" if goals are rare. */
function either(kind: string, list: HistoricMatch[], test: (m: HistoricMatch) => boolean, yes: string, no: string): EdgeTrend | null {
  if (list.length < MIN_SAMPLE) return null;
  const hits = list.filter(test).length;
  return hits * 2 >= list.length ? trend(kind, yes.replace("{n}", `${hits} of last ${list.length}`), hits, list.length) : trend(kind, no.replace("{n}", `${list.length - hits} of last ${list.length}`), list.length - hits, list.length);
}

/** One side's view of a result: goals for and against. */
const side = (m: HistoricMatch, team: string) => (m.home === team ? { f: m.fthg, a: m.ftag } : { f: m.ftag, a: m.fthg });

/** The current run from the latest game back: how many in a row pass `test`. */
function run(list: HistoricMatch[], test: (m: HistoricMatch) => boolean): number {
  let n = 0;
  for (const m of list) {
    if (!test(m)) break;
    n++;
  }
  return n;
}

const goals = (m: HistoricMatch) => m.fthg + m.ftag;

/** Works out one fixture's card from past results (newest first internally). */
export function edgeCard(f: UpcomingFixture, history: HistoricMatch[], now = new Date()): EdgeCard {
  const before = history.filter((m) => m.date < f.kickoff.slice(0, 10)).sort((a, b) => b.date.localeCompare(a.date));
  const of = (team: string) => before.filter((m) => m.home === team || m.away === team);
  const H = f.home;
  const A = f.away;
  const hAll = of(H).slice(0, 10);
  const aAll = of(A).slice(0, 10);
  const hHome = before.filter((m) => m.home === H).slice(0, 10);
  const aAway = before.filter((m) => m.away === A).slice(0, 10);
  const both = [...hAll, ...aAll];
  const h2h = before.filter((m) => (m.home === H && m.away === A) || (m.home === A && m.away === H)).slice(0, 8);
  const teams = `${H} and ${A}`; // both sides' last 10 games, counted together
  const list: Array<EdgeTrend | null> = [];

  // Goals, in the two teams' last games together.
  list.push(either("goals", both, (m) => goals(m) > 2.5, `Over 2.5 goals in {n} games played by ${teams} (10 each)`, `Under 2.5 goals in {n} games played by ${teams} (10 each)`));
  list.push(either("goals", both, (m) => goals(m) > 1.5, `Over 1.5 goals in {n} games played by ${teams} (10 each)`, `Under 1.5 goals in {n} games played by ${teams} (10 each)`));
  list.push(either("goals", both, (m) => goals(m) > 3.5, `Over 3.5 goals in {n} games played by ${teams} (10 each)`, `Under 3.5 goals in {n} games played by ${teams} (10 each)`));
  list.push(either("btts", both, (m) => m.fthg > 0 && m.ftag > 0, `Both teams scored in {n} games played by ${teams} (10 each)`, `At least one side failed to score in {n} games played by ${teams} (10 each)`));
  const withHt = both.filter((m) => m.hthg !== null && m.htag !== null);
  list.push(either("half", withHt, (m) => m.hthg! + m.htag! > 0, `A goal before half-time in {n} games played by ${teams} (10 each)`, `0-0 at half-time in {n} games played by ${teams} (10 each)`));

  // Form: the home side at home, the away side away.
  if (hHome.length >= MIN_SAMPLE) {
    const w = hHome.filter((m) => m.fthg > m.ftag).length;
    const unbeaten = hHome.filter((m) => m.fthg >= m.ftag).length;
    list.push(trend("form", `${H} won ${w} of their last ${hHome.length} home games`, w, hHome.length));
    if (unbeaten > w) list.push(trend("form", `${H} unbeaten in ${unbeaten} of their last ${hHome.length} home games`, unbeaten, hHome.length));
  }
  if (aAway.length >= MIN_SAMPLE) {
    const lost = aAway.filter((m) => m.ftag < m.fthg).length;
    const won = aAway.filter((m) => m.ftag > m.fthg).length;
    if (lost * 2 >= aAway.length) list.push(trend("form", `${A} lost ${lost} of their last ${aAway.length} away games`, lost, aAway.length));
    else list.push(trend("form", `${A} avoided defeat in ${aAway.length - lost} of their last ${aAway.length} away games`, aAway.length - lost, aAway.length));
    if (won * 2 >= aAway.length) list.push(trend("form", `${A} won ${won} of their last ${aAway.length} away games`, won, aAway.length));
  }

  // Current runs (any venue), shown when they are at least five games long.
  for (const [team, games] of [
    [H, of(H)],
    [A, of(A)],
  ] as const) {
    const unbeaten = run(games, (m) => side(m, team).f >= side(m, team).a);
    const winless = run(games, (m) => side(m, team).f <= side(m, team).a);
    const scoring = run(games, (m) => side(m, team).f > 0);
    const blank = run(games, (m) => side(m, team).f === 0);
    if (unbeaten >= MIN_SAMPLE) list.push(trend("run", `${team} unbeaten in their last ${unbeaten} games`, unbeaten, unbeaten));
    if (winless >= MIN_SAMPLE) list.push(trend("run", `${team} without a win in their last ${winless} games`, winless, winless));
    if (scoring >= MIN_SAMPLE) list.push(trend("run", `${team} scored in each of their last ${scoring} games`, scoring, scoring));
    if (blank >= 3) list.push(trend("run", `${team} failed to score in their last ${blank} games`, blank, blank));
  }

  // Head-to-head.
  if (h2h.length >= 3) {
    const meet = `${h2h.length} meetings`;
    const over = h2h.filter((m) => goals(m) > 2.5).length;
    list.push(over * 2 >= h2h.length ? trend("h2h", `Over 2.5 goals in ${over} of the last ${meet}`, over, h2h.length) : trend("h2h", `Under 2.5 goals in ${h2h.length - over} of the last ${meet}`, h2h.length - over, h2h.length));
    const btts = h2h.filter((m) => m.fthg > 0 && m.ftag > 0).length;
    if (btts * 2 >= h2h.length) list.push(trend("h2h", `Both teams scored in ${btts} of the last ${meet}`, btts, h2h.length));
    const hUnbeaten = h2h.filter((m) => side(m, H).f >= side(m, H).a).length;
    const aUnbeaten = h2h.length - h2h.filter((m) => side(m, H).f > side(m, H).a).length;
    if (hUnbeaten >= aUnbeaten) list.push(trend("h2h", `${H} unbeaten in ${hUnbeaten} of the last ${meet}`, hUnbeaten, h2h.length));
    else list.push(trend("h2h", `${A} unbeaten in ${aUnbeaten} of the last ${meet}`, aUnbeaten, h2h.length));
  }

  // Cards, where the files record bookings.
  const carded = both.filter((m) => m.cards !== null);
  list.push(either("cards", carded, (m) => m.cards! > 3.5, `Over 3.5 cards in {n} games played by ${teams} (10 each)`, `Under 3.5 cards in {n} games played by ${teams} (10 each)`));

  const trends = list.filter((t): t is EdgeTrend => t !== null && t.sample >= MIN_SAMPLE - (t.kind === "h2h" ? 2 : 0) && t.rate >= 0.6).sort((a, b) => b.strength - a.strength).slice(0, TOP);
  return { fixture: f, headline: trends[0] ?? null, trends, homeGames: of(H).length, awayGames: of(A).length, computedAt: now.toISOString() };
}

// --------------------------------------------------------------------------- the daily job

const KEY = (f: UpcomingFixture) => `${f.div}|${f.kickoff.slice(0, 10)}|${f.home}|${f.away}`;

/** Fetches the fixtures, works out every card in the next 48 hours and stores them. Returns how many were stored. */
export async function runEdge(db: EngineDb, now = new Date()): Promise<number> {
  if (historyStatus().state !== "ready") return 0;
  const [main, extra] = await Promise.all([download(`${BASE}/fixtures.csv`), download(`${BASE}/new_league_fixtures.csv`)]);
  const soon = parseFixtures(main, extra).filter((f) => {
    const t = Date.parse(f.kickoff);
    return t >= now.getTime() - AFTER_KICKOFF_MS && t <= now.getTime() + AHEAD_MS;
  });
  const history = historyMatches();
  const cards = soon.map((f) => edgeCard(f, history, now)).filter((c) => c.homeGames > 0 || c.awayGames > 0);
  db.replaceEdgeCards(
    cards.map((c) => ({ key: KEY(c.fixture), kickoff: c.fixture.kickoff, json: JSON.stringify(c) })),
    new Date(now.getTime() - AFTER_KICKOFF_MS).toISOString(),
  );
  log.info(`Edge: ${cards.length} fixture cards worked out for the next 48 hours.`);
  return cards.length;
}

/** Runs a few minutes after start (once the results have loaded), then every six hours. */
export function startEdge(db: EngineDb): void {
  let last = 0;
  const tick = () => {
    if (Date.now() - last < RUN_EVERY_MS || historyStatus().state !== "ready") return;
    last = Date.now();
    void runEdge(db).catch((err) => {
      last = 0;
      log.warn(`Edge: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  setInterval(tick, 5 * 60_000).unref?.();
  setTimeout(tick, 6 * 60_000).unref?.();
}

/** The stored cards for fixtures from two hours ago onwards, by kick-off. */
export function edgeCards(db: EngineDb, now = new Date()): EdgeCard[] {
  return db
    .listEdgeCards(new Date(now.getTime() - AFTER_KICKOFF_MS).toISOString())
    .map((r) => {
      try {
        return JSON.parse(r.json) as EdgeCard;
      } catch {
        return null;
      }
    })
    .filter((c): c is EdgeCard => c !== null);
}
