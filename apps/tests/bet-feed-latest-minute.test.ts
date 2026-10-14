import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { buildFeed, getSendingSettings, recordSimBets, saveSendingSettings, tooLate } from "../src/inplayguru/bet-feed";

const alert = (minute: number) =>
  ["🔔 Sustained momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", "Lyon vs Nice", "", `Timer: ${minute}'`, "Goals: 1 - 1", "Over/Under 2.50 Odds:", "9.20 1.05"].join("\n");

test("the latest-minute limit: 88' by default, nothing bet or simulated from a later alert", () => {
  const db = new EngineDb(":memory:", () => {});
  assert.equal(getSendingSettings(db).latestMinute, 88);
  assert.equal(tooLate({ minute: 93 }, { latestMinute: 88 }), true);
  assert.equal(tooLate({ minute: 88 }, { latestMinute: 88 }), false);
  assert.equal(tooLate({ minute: null }, { latestMinute: 88 }), false, "pre-match picks have no minute");
  assert.equal(tooLate({ minute: 93 }, { latestMinute: 0 }), false, "0 = off");
  saveSendingSettings(db, { enabled: true, strategies: { "sustained momentum": true }, stakes: { "sustained momentum": 1 } });
  db.upsertLivePick("chat", 1, alert(93), parseAlert(alert(93)), new Date(Date.now() - 30_000).toISOString());
  const feed = buildFeed(db, { markSent: false });
  assert.equal(feed.rows.length, 0);
  assert.match(feed.skipped[0]!.reason, /after the latest minute bet \(88'\)/);
  saveSendingSettings(db, { strategies: { "sustained momentum": false } });
  recordSimBets(db);
  const sim = JSON.parse((db.listLivePicks(1)[0] as unknown as { simRowJson?: string }).simRowJson ?? "null");
  if (sim) assert.match(sim.skipped ?? "", /latest minute/);
});
