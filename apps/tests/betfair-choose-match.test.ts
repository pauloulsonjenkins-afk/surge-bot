/**
 * Choosing Betfair's names by hand: the events offered when a match isn't found, using one of them (Match names added
 * and the pick put back on Betfair), and saying which Betfair competition a league is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { getSendingSettings } from "../src/inplayguru/bet-feed";
import { nearMatches } from "../src/betfair/exchange";
import { chooseBetfairMatch } from "../src/betfair/unplaced";
import { coverageOfAlertLeagues, setLeagueOverride } from "../src/betfair/competitions";

test("the nearest events Betfair returned are offered, best first, with unrelated ones left out", () => {
  const offered = nearMatches("Odra Bytom Odrzanski", "Zaglebie Sosnowiec", [
    { id: "1", name: "Wisla Krakow v Lech Poznan" },
    { id: "2", name: "Odra Bytom v Zaglebie Sosnowiec II" },
    { id: "3", name: "Zaglebie Lubin v Piast Gliwice" },
    { id: "2", name: "Odra Bytom v Zaglebie Sosnowiec II" },
    { id: "4", name: "Polish III Liga" },
  ]);
  assert.deepEqual(offered.map((e) => e.id), ["2", "3"]);
});

function setup() {
  const db = new EngineDb(":memory:", () => {});
  const text = ["🔔 Time to fight", "", "🇵🇱 Poland III Liga (3rd vs 9th)", "Odra Bytom Odrzanski vs Zaglebie Sosnowiec", "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "1.60 2.20"].join("\n");
  db.upsertLivePick("chat", 1, text, parseAlert(text), new Date().toISOString());
  const id = db.listLivePicks(5)[0]!.id;
  db.setPickExchange(id, "off", null);
  db.setPickExchangeCandidates(id, [{ id: "E2", name: "Odra Bytom v Zaglebie Sosnowiec" }]);
  return { db, id };
}

test("using an offered event adds the Match names and puts the pick on Betfair under it", () => {
  const { db, id } = setup();
  assert.equal(db.getLivePick(id)?.exchangeCandidates?.[0]?.name, "Odra Bytom v Zaglebie Sosnowiec");
  const r = chooseBetfairMatch(db, id, "Odra Bytom v Zaglebie Sosnowiec");
  assert.equal(r.added.length, 1, "only the home team is spelled differently");
  assert.match(getSendingSettings(db).aliases, /Odra Bytom Odrzanski = Odra Bytom/);
  const p = db.getLivePick(id)!;
  assert.equal(p.exchange, "on");
  assert.equal(p.exchangeEvent, "Odra Bytom v Zaglebie Sosnowiec");
  assert.equal(p.exchangeEventId, "E2");
  assert.equal(p.exchangeCandidates, null);
});

test("only an event Betfair offered can be used", () => {
  const { db, id } = setup();
  assert.throws(() => chooseBetfairMatch(db, id, "Portugal v Norway"), /isn't one Betfair offered/);
});

test("a league can be matched to a Betfair competition by hand, marked not on Betfair, or put back", () => {
  const { db } = setup();
  db.saveBetfairCompetitions([{ id: "9", name: "Polish 3 Liga", region: "POL", marketCount: 5 }], new Date().toISOString());
  const league = () => coverageOfAlertLeagues(db).find((l) => /III Liga/.test(l.name))!;
  setLeagueOverride(db, league().name, "Polish 3 Liga");
  assert.equal(league().status, "on");
  assert.equal(league().betfair?.name, "Polish 3 Liga");
  assert.equal(league().overridden, true);
  setLeagueOverride(db, league().name, "none");
  assert.equal(league().status, "not");
  setLeagueOverride(db, league().name, null);
  assert.equal(league().overridden, undefined);
  assert.throws(() => setLeagueOverride(db, league().name, "Made Up League"), /isn't a competition/);
});
