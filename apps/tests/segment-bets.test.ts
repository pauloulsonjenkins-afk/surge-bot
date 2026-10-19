/**
 * Betting a watched slice on its own (Strategies: Second Pour's Golden alerts). Its own Live / Sim switch and stake;
 * the rest of the strategy follows the strategy's own switch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";

const alert = (n: number, goals: string, da: string) =>
  [
    "🔔 Favourite pressure 2nd half", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 62'", `Goals: ${goals}`,
    `Dangerous Attacks: ${da}`, "", "1X2 Pre-Match Odds:", "1.60 4.00 5.50", "Over/Under 2.50 Odds:", "1.50 2.50",
  ].join("\n");

function setup() {
  const db = new EngineDb(":memory:", () => {});
  const at = new Date(Date.now() - 60_000).toISOString();
  db.upsertLivePick("chat", 1, alert(1, "1 - 1", "50 - 20"), parseAlert(alert(1, "1 - 1", "50 - 20")), at); // Golden
  db.upsertLivePick("chat", 2, alert(2, "1 - 1", "30 - 25"), parseAlert(alert(2, "1 - 1", "30 - 25")), at); // the rest
  return db;
}
const ids = (db: EngineDb) => new Map(db.listLivePicks(5).map((p) => [p.home, p.id]));

test("Golden Live while the strategy is in Sim: only Golden alerts are bet, at Golden's own stake", () => {
  const db = setup();
  saveSendingSettings(db, { enabled: true, stakes: { "favourite pressure 2nd half": 1 }, strategies: { "favourite pressure 2nd half": false } });
  saveSendingSettings(db, { segmentBets: { "favourite pressure 2nd half#golden": { live: true, stake: 3 } } });
  const feed = buildFeed(db, { markSent: false });
  const m = ids(db);
  assert.deepEqual(feed.rows.map((r) => r.pickId), [m.get("Home 1")]);
  assert.equal(feed.rows[0]!.stake, 3);
  assert.ok(feed.skipped.some((s) => s.pickId === m.get("Home 2") && /switch is off/.test(s.reason)));
});

test("strategy Live with Golden at a bigger stake: both bet, Golden at its own stake", () => {
  const db = setup();
  saveSendingSettings(db, { enabled: true, stakes: { "favourite pressure 2nd half": 1 }, strategies: { "favourite pressure 2nd half": true } });
  saveSendingSettings(db, { segmentBets: { "favourite pressure 2nd half#golden": { live: true, stake: 2 } } });
  const rows = buildFeed(db, { markSent: false }).rows;
  const m = ids(db);
  assert.equal(rows.find((r) => r.pickId === m.get("Home 1"))!.stake, 2);
  assert.equal(rows.find((r) => r.pickId === m.get("Home 2"))!.stake, 1);
});

test("null puts Golden back to following the strategy", () => {
  const db = setup();
  saveSendingSettings(db, { segmentBets: { "favourite pressure 2nd half#golden": { live: true, stakePct: 3 } } });
  assert.equal(getSendingSettings(db).segmentBets["favourite pressure 2nd half#golden"]!.stakePct, 3);
  saveSendingSettings(db, { segmentBets: { "favourite pressure 2nd half#golden": null } });
  assert.deepEqual(getSendingSettings(db).segmentBets, {});
});
