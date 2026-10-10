import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeCard, parseFixtures, strengthOf, ukKickoff } from "../src/edge/edge";
import type { HistoricMatch } from "../src/history/football-data";

test("UK kick-off times become UTC, summer and winter", () => {
  assert.equal(ukKickoff("10/10/2026", "15:00"), "2026-10-10T14:00:00.000Z");
  assert.equal(ukKickoff("10/12/2026", "15:00"), "2026-12-10T15:00:00.000Z");
});

test("both fixtures files are read: main leagues by code, extra leagues by country", () => {
  const f = parseFixtures("Div,Date,Time,HomeTeam,AwayTeam\nE0,10/10/2026,15:00,Arsenal,Leeds\nZZ,10/10/2026,15:00,A,B", "Country,League,Date,Time,Home,Away\nArgentina,Liga Profesional,09/10/2026,18:30,Aldosivi,Sarmiento Junin");
  assert.deepEqual(f.map((x) => `${x.div} ${x.home} v ${x.away}`), ["E0 Arsenal v Leeds", "ARG Aldosivi v Sarmiento Junin"]);
});

test("a bigger sample ranks above a perfect small one", () => {
  assert.ok(strengthOf(45, 50) > strengthOf(9, 10));
});

const m = (date: string, home: string, away: string, fthg: number, ftag: number): HistoricMatch => ({
  div: "E0", season: 2026, date, home, away, fthg, ftag, hthg: 0, htag: 0, corners: null, cards: null, odds: null,
});

test("every trend shows its sample, and the headline is the strongest", () => {
  const history: HistoricMatch[] = [];
  for (let i = 1; i <= 10; i++) {
    history.push(m(`2026-09-${String(i).padStart(2, "0")}`, "Home FC", `Opp${i}`, 3, 1)); // Home FC wins every home game, 4 goals
    history.push(m(`2026-08-${String(i).padStart(2, "0")}`, `Opp${i}`, "Away FC", 2, 1)); // Away FC loses every away game, 3 goals
  }
  const card = edgeCard({ div: "E0", league: "Premier League", country: "England", kickoff: "2026-10-10T14:00:00.000Z", home: "Home FC", away: "Away FC" }, history);
  assert.ok(card.headline);
  assert.ok(card.trends.every((t) => /\d+ of (the |their )?last \d+|last \d+ games|each of their last \d+/.test(t.text)));
  assert.ok(card.trends.some((t) => t.text === "Home FC won 10 of their last 10 home games"));
  assert.ok(card.trends.some((t) => t.text.startsWith("Over 2.5 goals in 20 of last 20")));
  assert.equal(card.headline!.strength, Math.max(...card.trends.map((t) => t.strength)));
});
