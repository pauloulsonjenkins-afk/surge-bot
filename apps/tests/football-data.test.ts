import { test } from "node:test";
import assert from "node:assert/strict";
import { DIVISIONS, leagueProfiles, leagueTable, parseCsv, splitCsvLine, tablePositions, testAwayLay, type HistoricMatch } from "../src/history/football-data";

const E0 = DIVISIONS.find((d) => d.code === "E0")!;
const NOW = new Date("2026-10-08T12:00:00Z");

test("CSV lines with quoted commas split correctly", () => {
  assert.deepEqual(splitCsvLine('a,"b, c",d'), ["a", "b, c", "d"]);
});

test("a main-league file is read, preferring Betfair Exchange closing prices; unplayed rows are skipped", () => {
  const csv = [
    "\uFEFFDiv,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,HC,AC,PSCH,PSCD,PSCA,BFECH,BFECD,BFECA",
    "E0,15/08/2025,Liverpool,Bournemouth,4,2,1,0,6,7,1.3,6,9,1.32,6.8,10",
    "E0,16/08/2025,Leeds,Spurs,,,,,,,2,3,4,,,",
  ].join("\n");
  const ms = parseCsv(csv, E0, 2021);
  assert.equal(ms.length, 1);
  assert.equal(ms[0]!.season, 2025);
  assert.equal(ms[0]!.corners, 13);
  assert.deepEqual(ms[0]!.odds, { home: 1.32, draw: 6.8, away: 10, source: "Betfair Exchange (closing)" });
});

const m = (fthg: number, ftag: number, away: number): HistoricMatch => ({
  div: "E0", season: 2025, date: "2025-09-01", home: "H", away: "A", fthg, ftag, hthg: 0, htag: 0, corners: 10, odds: { home: 2, draw: 3.5, away, source: "x" },
});

test("profiles count home, draw and away wins", () => {
  const p = leagueProfiles([m(1, 0, 4), m(1, 1, 4), m(0, 2, 4), m(2, 0, 4)], 6, NOW)[0]!;
  assert.equal(p.homePct, 50);
  assert.equal(p.drawPct, 25);
  assert.equal(p.awayPct, 25);
  assert.equal(p.homeEdge, 25);
  assert.equal(p.firstHalfGoalPct, 0);
});

const row = (date: string, home: string, away: string, fthg: number, ftag: number): HistoricMatch => ({
  div: "E0", season: 2025, date, home, away, fthg, ftag, hthg: 0, htag: 0, corners: null, cards: null, odds: null,
});

// Top beats Mid 3-0, beats Bottom (away) 2-0, then Mid draws Bottom 1-1: Top 6pts/+5, Bottom 1pt/-2, Mid 1pt/-3 -
// Bottom outranks Mid on goal difference despite the same points.
const SMALL_LEAGUE = [row("2025-08-10", "Top", "Mid", 3, 0), row("2025-08-17", "Bottom", "Top", 0, 2), row("2025-08-24", "Mid", "Bottom", 1, 1)];

test("leagueTable: points, then goal difference, from results so far - nothing from on or after the cutoff counts", () => {
  const table = leagueTable([...SMALL_LEAGUE, row("2025-09-01", "Top", "Mid", 9, 0)], "E0", 2025, "2025-09-01");
  assert.deepEqual(table.map((t) => t.team), ["Top", "Bottom", "Mid"]);
  assert.equal(table[0]!.points, 6);
  assert.equal(table[0]!.played, 2);
  assert.equal(table[0]!.goalDiff, 5);
});

test("tablePositions: each side's spot in its table right now, from results already on file - free, no new source", () => {
  const now = new Date("2025-09-01T12:00:00Z");
  assert.deepEqual(tablePositions(SMALL_LEAGUE, "Top", "Mid", now), { home: { position: 1, of: 3 }, away: { position: 3, of: 3 } });
  // A team never seen (not on file at all) still resolves via the other side's division/season.
  assert.deepEqual(tablePositions(SMALL_LEAGUE, "Top", "Nowhere FC", now), { home: { position: 1, of: 3 }, away: null });
  // Neither side on file: null outright (most lower-league/non-European alerts).
  assert.equal(tablePositions(SMALL_LEAGUE, "Nowhere FC", "Nowhere Else FC", now), null);
});

test("away lay: a win pays the lay stake less commission, an away win loses the £1 liability; prices out of range are skipped", () => {
  const r = testAwayLay({ minOdds: 3, maxOdds: 5, commission: 0.05, spread: 0 }, [m(1, 0, 5), m(0, 1, 5), m(1, 0, 10)], NOW);
  assert.equal(r.total.bets, 2);
  assert.equal(r.total.won, 1);
  // won: 1 / (5 - 1) x 0.95 = 0.2375; lost: -1
  assert.equal(r.total.profit, Math.round((0.2375 - 1) * 100) / 100);
});
