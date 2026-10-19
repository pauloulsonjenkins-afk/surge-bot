/**
 * Golden: statuses, watching a finder suggestion (it becomes a slice from today), and the finder itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineDb } from "../src/storage/engine-db";
import { parseAlert } from "../src/inplayguru/parse-alert";
import { recordSimBets, saveSendingSettings } from "../src/inplayguru/bet-feed";
import { findGolden, goldenReport, loadCustomSegments, unwatchSegment, watchSegment } from "../src/server/golden";
import { segmentsOf, setCustomSegments } from "../src/server/segments";

const alert = (n: number, goals: string, result: "hit" | "miss") =>
  [
    "🔔 Blistering Momentum", "", "🇫🇷 France Ligue 1 (3rd vs 9th)", `Home ${n} vs Away ${n}`, "", "Timer: 60'", `Goals: ${goals}`,
    `Over/Under ${goals === "0 - 0" ? "0.50" : "1.50"} Odds:`, "2.00 1.80", "", "⸻⸻ Match Summary ⸻⸻", "Half-Time Score: 0-0", `Full-Time Score: ${result === "hit" ? "9-9" : goals.replace(" - ", "-")}`, "", result === "hit" ? "✅ Hit" : "❌ Miss",
  ].join("\n");

test("watching a suggestion adds a slice from today; stopping removes it; built-in ones can't be stopped", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  loadCustomSegments(db);
  watchSegment(db, "Blistering Momentum", ["score00"]);
  assert.ok(segmentsOf("blistering momentum").some((s) => s.label === "Golden: 0-0" && s.custom));
  assert.ok(goldenReport(db, new Date(), { skipFinder: true }).slices.some((s) => s.strategyKey === "blistering momentum" && s.id === "f-score00"), "shows straight away, before anything settles");
  assert.throws(() => watchSegment(db, "blistering momentum", ["score00"]), /already/);
  unwatchSegment(db, "blistering momentum", "f-score00");
  assert.equal(segmentsOf("blistering momentum").length, 0);
  assert.throws(() => unwatchSegment(db, "favourite pressure 2nd half", "golden"), /Only slices added/);
  assert.ok(goldenReport(db).suggestions);
});

test("the finder suggests a slice that beat the rest in both halves of the record, and not when it doesn't", () => {
  setCustomSegments([]);
  const db = new EngineDb(":memory:", () => {});
  saveSendingSettings(db, { enabled: true, stakes: { "blistering momentum": 1 }, dailyCap: 1000 });
  recordSimBets(db, new Date(Date.now() - 120_000)); // Sim recording starts before the alerts
  // 0-0 alerts win 80%, the rest 35%, all at evens: 0-0 is clearly better, in both halves.
  for (let n = 1; n <= 200; n++) {
    const zero = n % 2 === 0;
    const win = zero ? n % 10 !== 0 && n % 10 !== 6 : n % 20 < 7;
    const goals = zero ? "0 - 0" : "1 - 0";
    const at = new Date(Date.now() - 60_000).toISOString();
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!, parseAlert(alert(n, goals, win ? "hit" : "miss").split("\n\n⸻")[0]!), at);
    recordSimBets(db);
    db.upsertLivePick("chat", n, alert(n, goals, win ? "hit" : "miss"), parseAlert(alert(n, goals, win ? "hit" : "miss")), at);
  }
  const found = findGolden(db);
  assert.ok(found.some((g) => g.strategyKey === "blistering momentum" && g.rule.includes("score00")), JSON.stringify(found.map((g) => g.label)));
  assert.ok(!found.some((g) => g.rule.length === 1 && g.rule[0] === "apart1"), "the losing slice isn't suggested");
});
