/**
 * Betfair coverage: matching InPlayGuru's league names ("Spain La Liga") to Betfair's competition names ("Spanish La
 * Liga"), so leagues with no Betfair markets can be switched off in InPlayGuru.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { checkLeague, saveLeagueList, savedListCoverage, splitCountry, type BetfairCompetition } from "../src/betfair/competitions";

const BETFAIR = [
  "English Premier League",
  "English Championship",
  "English Womens Super League",
  "Spanish La Liga",
  "French Ligue 1",
  "German Bundesliga",
  "German Bundesliga 2",
  "Dutch Eredivisie",
  "Bolivian Primera Division",
  "Brazilian Serie A",
  "US Major League Soccer",
  "UEFA Champions League",
  "Japanese J League",
  "Australia Cup",
  "Brazilian Serie B",
].map((name, i): BetfairCompetition => ({ id: String(i + 1), name, region: null, marketCount: 10, firstSeen: "2026-10-01", lastSeen: "2026-10-01" }));

const status = (name: string) => checkLeague(name, BETFAIR).status;
const matched = (name: string) => checkLeague(name, BETFAIR).betfair?.name ?? null;

test("the country is read off the front of InPlayGuru's name", () => {
  assert.deepEqual(splitCountry("Bolivia Copa Division Profesional"), { country: "bolivia", rest: "copa division profesional" });
  assert.deepEqual(splitCountry("Northern Ireland Premiership"), { country: "northern ireland", rest: "premiership" });
  assert.equal(splitCountry("UEFA Champions League").country, null);
});

test("clear matches are on Betfair, whatever the country is called", () => {
  assert.equal(status("England Premier League"), "on");
  assert.equal(matched("England Premier League"), "English Premier League");
  assert.equal(matched("Spain La Liga"), "Spanish La Liga");
  assert.equal(matched("France Ligue 1"), "French Ligue 1");
  assert.equal(matched("Netherlands Eredivisie"), "Dutch Eredivisie");
  assert.equal(matched("Brazil Serie A"), "Brazilian Serie A");
  assert.equal(matched("Germany Bundesliga 2"), "German Bundesliga 2");
  assert.equal(matched("Europe UEFA Champions League"), "UEFA Champions League");
});

test("Austria isn't Australia, and a distinctive word has to match", () => {
  assert.notEqual(matched("Austria Cup"), "Australia Cup");
  assert.equal(status("Austria Cup"), "not");
  assert.equal(status("Brazil Serie B"), "on");
  assert.equal(status("Brazil Paulista Serie B"), "maybe", "Paulista isn't in Betfair's name");
});

test("a pasted list is saved and re-checked later", () => {
  const db = new EngineDb(":memory:", () => {});
  saveLeagueList(db, ["Spain La Liga", "Kenya Premier League"]);
  db.saveBetfairCompetitions([{ id: "1", name: "Spanish La Liga", region: null, marketCount: 5 }], "2026-10-01T00:00:00Z");
  const r = savedListCoverage(db)!;
  assert.deepEqual(r.leagues.map((l) => l.status), ["on", "not"]);
});

test("a league Betfair names differently is a possible match, shown for checking", () => {
  const r = checkLeague("Bolivia Copa Division Profesional", BETFAIR);
  assert.equal(r.status, "maybe");
  assert.equal(r.betfair?.name, "Bolivian Primera Division");
});

test("no competition for the country is not on Betfair; women's and youth leagues only match their own kind", () => {
  assert.equal(status("Kenya Premier League"), "not");
  assert.equal(status("England Premier League U21"), "not");
  assert.equal(matched("England Women Super League"), "English Womens Super League");
  assert.notEqual(matched("England Premier League"), "English Womens Super League");
});

test("competitions are kept as they're seen, so a league between seasons isn't forgotten", () => {
  const db = new EngineDb(":memory:", () => {});
  db.saveBetfairCompetitions([{ id: "1", name: "English Premier League", region: "GBR", marketCount: 40 }], "2026-09-01T00:00:00Z");
  db.saveBetfairCompetitions([{ id: "2", name: "Spanish La Liga", region: "ESP", marketCount: 30 }], "2026-10-01T00:00:00Z");
  const list = db.listBetfairCompetitions();
  assert.deepEqual(list.map((c) => [c.name, c.lastSeen]), [
    ["English Premier League", "2026-09-01T00:00:00Z"],
    ["Spanish La Liga", "2026-10-01T00:00:00Z"],
  ]);
});
