/**
 * "Fresh start": every figure counts only alerts from a chosen moment on, nothing is deleted,
 * and undoing it brings the old figures straight back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { saveSendingSettings } from "../src/inplayguru/bet-feed";

function settledAlert(home: string, away: string): string {
  return [
    "🔔 Blistering Momentum",
    "",
    "🇫🇷 France Ligue 1 (3rd vs 9th)",
    `${home} vs ${away}`,
    "",
    "Timer: 60'",
    "Goals: 1 - 0",
    "Over/Under 1.50 Odds:",
    "1.80 2.00",
    "",
    "⸻⸻ Match Summary ⸻⸻",
    "",
    "Half-Time Score: 1-0",
    "Full-Time Score: 2-0",
    "",
    "✅ Hit",
  ].join("\n");
}

function setup() {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { stakes: { "blistering momentum": 2 } });
  let id = 1;
  for (const [h, a] of [["Lens", "Lille"], ["Nice", "Brest"]] as const) {
    const text = settledAlert(h, a);
    db.upsertLivePick("chat", id++, text, parseAlert(text), new Date().toISOString());
  }
  return db;
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const aWeekAgo = () => new Date(Date.now() - 7 * 86_400_000).toISOString();

test("with no fresh start every figure counts", () => {
  const db = setup();
  assert.equal(db.getFreshStart(), null);
  assert.equal(db.hitRateStats(null).totals.hits, 2);
  assert.equal(db.listStrategiesForAdmin()[0]?.hits, 2);
  assert.equal(db.listResultsForWinLoss(aWeekAgo()).length, 2);
});

test("a fresh start zeroes the Dashboard, hit rates and Win/Loss figures, and undo brings them back", () => {
  const db = setup();
  db.setFreshStart(inAnHour()); // everything stored so far is older than this

  assert.equal(db.hitRateStats(null).totals.hits, 0);
  assert.equal(db.hitRateStats(30).totals.hits, 0);
  assert.equal(db.performanceCells(null).length, 0);
  assert.equal(db.listResultsForWinLoss(aWeekAgo()).length, 0);

  const row = db.listStrategiesForAdmin()[0]!;
  assert.equal(row.hits, 0);
  assert.equal(row.alertsSince, 0);
  assert.equal(row.alerts, 2, "the stored total is unchanged, so the delete messages stay accurate");

  db.setFreshStart(null);
  assert.equal(db.hitRateStats(null).totals.hits, 2);
  assert.ok(db.performanceCells(null).length > 0);
  assert.equal(db.listResultsForWinLoss(aWeekAgo()).length, 2);
  assert.equal(db.listStrategiesForAdmin()[0]?.alertsSince, 2);
});

test("a fresh start in the past changes nothing, and only newer alerts count after one", async () => {
  const db = setup();
  db.setFreshStart(aWeekAgo());
  assert.equal(db.hitRateStats(null).totals.hits, 2);
  assert.equal(db.listResultsForWinLoss(aWeekAgo()).length, 2);
  // an alert that arrives after the start time counts; the two stored earlier do not
  await new Promise((r) => setTimeout(r, 30)); // so the stored alerts are clearly older than the start time
  db.setFreshStart(new Date().toISOString());
  await new Promise((r) => setTimeout(r, 30));
  const text = settledAlert("Metz", "Reims");
  db.upsertLivePick("chat", 3, text, parseAlert(text), new Date().toISOString());
  assert.equal(db.hitRateStats(null).totals.hits, 1);
  assert.equal(db.listStrategiesForAdmin()[0]?.alertsSince, 1);
});

test("nothing is deleted, and a damaged setting is treated as no fresh start", () => {
  const db = setup();
  db.setFreshStart(inAnHour());
  assert.equal(db.countLivePicks(), 2);
  db.setSetting("fresh_start", "not json");
  assert.equal(db.getFreshStart(), null);
  assert.equal(db.hitRateStats(null).totals.hits, 2);
});
