/**
 * Live tab, "Bet this for real": a Sim pick handed to direct betting by hand, at its strategy's stake, with the usual
 * safety checks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { betPickNow, saveSendingSettings } from "../src/inplayguru/bet-feed";

const alert = (n: number) =>
  ["🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", "Goals: 0 - 0", "Over/Under 0.50 Odds:", "2.00 1.80"].join("\n");

function setup(ageMs = 60_000) {
  const db = new EngineDb(":memory:", () => {});
  // Betting on, but this strategy in Sim.
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 2 }, strategies: { "blistering momentum": false } });
  db.upsertLivePick("chat", 1, alert(1), parseAlert(alert(1)), new Date(Date.now() - ageMs).toISOString());
  return { db, id: db.listLivePicks(5)[0]!.id };
}

test("a fresh Sim pick is handed to direct betting at its strategy's stake, once", () => {
  const { db, id } = setup();
  const row = betPickNow(db, id, { directLive: true });
  assert.equal(row.stake, 2);
  assert.equal(row.selectionName, "Over 0.5 Goals");
  assert.ok(db.getLivePick(id)!.sentAt, "now counts as sent (Live)");
  assert.throws(() => betPickNow(db, id, { directLive: true }), /already been handed/);
});

test("refused when direct betting isn't Live, or the alert is too old to bet", () => {
  assert.throws(() => betPickNow(setup().db, setup().id, { directLive: false }), /isn't Live/);
  const old = setup(30 * 60_000);
  assert.throws(() => betPickNow(old.db, old.id, { directLive: true }), /Too late/);
});

test("refused above the highest stake allowed", () => {
  const { db, id } = setup();
  saveSendingSettings(db, { maxStake: 1 });
  assert.throws(() => betPickNow(db, id, { directLive: true }), /highest stake/);
});
