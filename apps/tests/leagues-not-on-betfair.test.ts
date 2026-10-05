/**
 * Leagues not on Betfair: hiding one on the Leagues page takes its alerts out of every money figure (Win/Loss,
 * Strategies), as it already did for the Dashboard, except picks with real money on them; and the Schedule lists only
 * fixtures in leagues Betfair has.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { fixtureLeagueChecker, setLeagueOverride } from "../src/betfair/competitions";

function alert(league: string, n: number): string {
  return [
    "🔔 Time to fight", "", `🇫🇷 ${league} (3rd vs 9th)`, `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "3.00 1.40",
    "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", "Full-Time Score: 1-1", "", "✅ Hit",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  const add = (league: string, n: number) => {
    const text = alert(league, n);
    db.upsertLivePick("chat", n, text, parseAlert(text), new Date().toISOString());
    return db.listLivePicks(200).find((p) => p.messageId === n)!;
  };
  return { db, add };
}

test("a hidden league's simulation picks leave the money figures; picks with real money stay", () => {
  const { db, add } = setup();
  const kept = add("France Ligue 1", 1);
  const hiddenSim = add("France National 3", 2);
  const hiddenReal = add("France National 3", 3);
  db.setManualBet(hiddenReal.id, { stake: 2, odds: 3 });
  assert.equal(db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").length, 3);

  db.updateLeague(hiddenSim.leagueKey, { hidden: true });
  const ids = db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").map((r) => r.id);
  assert.deepEqual(ids.sort(), [kept.id, hiddenReal.id].sort());
  // The full Excel download still has everything.
  assert.equal(db.listResultsForWinLoss("1970-01-01T00:00:00.000Z", { includeHiddenLeagues: true }).length, 3);
  // Showing the league again brings its picks back.
  db.updateLeague(hiddenSim.leagueKey, { hidden: false });
  assert.equal(db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").length, 3);
});

test("the Schedule's checker leaves out leagues Betfair doesn't have, and follows the Leagues page's overrides", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(fixtureLeagueChecker(db), null); // no Betfair list yet: nothing is judged
  db.saveBetfairCompetitions(
    [
      { id: "1", name: "English Premier League", region: "GBR", marketCount: 40 },
      { id: "2", name: "UEFA Champions League", region: null, marketCount: 30 },
      { id: "3", name: "Spanish La Liga", region: "ESP", marketCount: 30 },
    ],
    new Date().toISOString(),
  );
  const check = fixtureLeagueChecker(db)!;
  assert.notEqual(check("Premier League", "England"), "not");
  assert.notEqual(check("UEFA Champions League", "World"), "not");
  assert.equal(check("Liga Nacional", "Guatemala"), "not");
  // Marked "not on Betfair" by hand on the Leagues page.
  setLeagueOverride(db, "Spain La Liga", "none");
  assert.equal(fixtureLeagueChecker(db)!("La Liga", "Spain"), "not");
});
