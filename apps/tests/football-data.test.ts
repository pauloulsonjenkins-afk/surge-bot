import { test } from "node:test";
import assert from "node:assert/strict";
import { DIVISIONS, leagueProfiles, parseCsv, splitCsvLine, testAwayLay, type HistoricMatch } from "../src/history/football-data";

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

test("away lay: a win pays the lay stake less commission, an away win loses the £1 liability; prices out of range are skipped", () => {
  const r = testAwayLay({ minOdds: 3, maxOdds: 5, commission: 0.05, spread: 0 }, [m(1, 0, 5), m(0, 1, 5), m(1, 0, 10)], NOW);
  assert.equal(r.total.bets, 2);
  assert.equal(r.total.won, 1);
  // won: 1 / (5 - 1) x 0.95 = 0.2375; lost: -1
  assert.equal(r.total.profit, Math.round((0.2375 - 1) * 100) / 100);
});
