import { test } from "node:test";
import assert from "node:assert/strict";
import { historyTeam, teamGoalStats, teamIndex } from "../src/model/team-goals-test";
import type { HistoricMatch } from "../src/history/football-data";

const m = (date: string, home: string, away: string, ft: [number, number], ht: [number, number]): HistoricMatch => ({
  div: "E1", season: 2026, date, home, away, fthg: ft[0], ftag: ft[1], hthg: ht[0], htag: ht[1], corners: null, cards: null, odds: null,
});

test("lively teams: both teams' last 10 games before the day, % with a second-half goal and % over 1.5", () => {
  const list: HistoricMatch[] = [];
  for (let i = 1; i <= 10; i++) {
    const d = `2026-09-${String(i + 10).padStart(2, "0")}`;
    list.push(m(d, "Sheffield Weds", `Other${i}`, i <= 8 ? [2, 1] : [0, 0], i <= 8 ? [1, 0] : [0, 0]));
    list.push(m(d, `Else${i}`, "Middlesbrough", [1, 1], [0, 0]));
  }
  list.push(m("2026-10-20", "Sheffield Weds", "X", [0, 0], [0, 0])); // after the pick's day: not counted
  const idx = teamIndex(list);
  assert.equal(historyTeam("Sheffield Wednesday", idx), "Sheffield Weds");
  assert.equal(historyTeam("Middlesbrough FC", idx), "Middlesbrough");
  const s = teamGoalStats("Sheffield Weds", "Middlesbrough FC", "2026-10-11", idx)!;
  assert.equal(s.games, 20);
  assert.equal(s.h2, 90); // 8 of Sheffield's + all 10 of Middlesbrough's had a second-half goal
  assert.equal(s.o15, 90);
  assert.equal(teamGoalStats("Nobody", "Middlesbrough", "2026-10-11", idx), null);
});

test("teams from different leagues aren't trusted as a match", () => {
  const list: HistoricMatch[] = [];
  for (let i = 1; i <= 6; i++) {
    list.push(m(`2026-09-1${i}`, "Lens", `A${i}`, [1, 1], [0, 0]));
    list.push({ ...m(`2026-09-1${i}`, "Lille", `B${i}`, [1, 1], [0, 0]), div: "F2" });
  }
  assert.equal(teamGoalStats("Lens", "Lille", "2026-10-11", teamIndex(list)), null);
});
