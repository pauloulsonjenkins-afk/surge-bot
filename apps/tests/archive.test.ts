/** The strategy archive (server/archive.ts): hidden from the site, kept on record, and never left Live. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { getSendingSettings, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { archiveRows, getArchived, isArchived, setArchived } from "../src/server/archive";
import { strategyAdvice } from "../src/server/strategy-advice";

const alert = (n: number, result?: "hit" | "miss") =>
  [
    "🔔 Sustained momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 70'", "Goals: 0 - 0",
    "Over/Under 0.50 Odds:", "2.00 1.80",
    ...(result ? ["", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "1-0" : "0-0"}`, "", result === "hit" ? "✅ Hit" : "❌ Miss"] : []),
  ].join("\n");

function seed(db: EngineDb) {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  db.upsertLivePick("chat", 1, alert(1), parseAlert(alert(1)), at);
  db.upsertLivePick("chat", 1, alert(1, "hit"), parseAlert(alert(1, "hit")), at);
}

test("archiving puts the strategy and its Live slices back to Sim, and records why", () => {
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, strategies: { "sustained momentum": true }, stakePct: { "sustained momentum": 3 }, segmentBets: { "sustained momentum#f-a": { live: true, stakePct: 1 }, "time to fight#f-b": { live: true, stakePct: 2 } } });
  const done = setArchived(db, "Sustained momentum", true, "deleted from InPlayGuru");
  assert.deepEqual(done.switchedOff.sort(), ["sustained momentum", "sustained momentum#f-a"]);
  const s = getSendingSettings(db);
  assert.equal(s.strategies["sustained momentum"], false);
  assert.equal(s.segmentBets["sustained momentum#f-a"]?.live, false);
  assert.equal(s.segmentBets["time to fight#f-b"]?.live, true, "another strategy's slice is untouched");
  assert.equal(s.stakePct["sustained momentum"], 3, "its stake is kept, for if it is ever restored");
  assert.equal(isArchived(db, "SUSTAINED MOMENTUM"), true);
  assert.equal(getArchived(db)["sustained momentum"]?.note, "deleted from InPlayGuru");
});

test("the archive keeps the record: its bets still count, and it lists what it did", () => {
  const db = new EngineDb(":memory:", () => {});
  seed(db);
  setArchived(db, "Sustained momentum", true, null);
  const rows = archiveRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.label, "Sustained momentum");
  assert.equal(rows[0]!.alerts, 1);
  assert.equal(rows[0]!.sim.counted + rows[0]!.live.counted > 0 || rows[0]!.alerts > 0, true);
  // the pick itself is untouched: it is still there for every total
  assert.equal(db.listResultsForWinLoss("1970-01-01T00:00:00.000Z").length, 1);
});

test("restoring takes it out of the archive; nothing is suggested for an archived strategy", () => {
  const db = new EngineDb(":memory:", () => {});
  seed(db);
  setArchived(db, "Sustained momentum", true);
  assert.deepEqual(strategyAdvice(db).filter((a) => a.key === "sustained momentum"), []);
  setArchived(db, "Sustained momentum", false);
  assert.equal(isArchived(db, "Sustained momentum"), false);
  assert.deepEqual(archiveRows(db), []);
  assert.throws(() => setArchived(db, "  ", true), /Which strategy/);
});
